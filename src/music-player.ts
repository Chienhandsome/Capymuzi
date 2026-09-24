import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type DiscordGatewayAdapterCreator,
  type VoiceConnection,
} from "@discordjs/voice";
import type { Guild, Message, VoiceBasedChannel } from "discord.js";
import { createPlayerPanel } from "./player-panel.js";
import { createYoutubeAudioProcess, type Track, type YoutubeAudioProcess } from "./youtube.js";

export interface PlayerSnapshot {
  current: Track | null;
  queue: readonly Track[];
  historyCount: number;
  loopCurrent: boolean;
  volume: number;
  paused: boolean;
  voiceChannelId: string | null;
}

type EndAction = "normal" | "skip" | "previous" | "stop";

export class GuildMusicPlayer {
  private readonly audioPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  private readonly queue: Track[] = [];
  private readonly history: Track[] = [];
  private current: Track | null = null;
  private connection: VoiceConnection | null = null;
  private audioProcess: YoutubeAudioProcess | null = null;
  private panelMessage: Message | null = null;
  private loopCurrent = false;
  private volume = 50;
  private endAction: EndAction = "normal";
  private handlingIdle = false;
  private startingTrack = false;

  constructor(private readonly guild: Guild) {
    this.audioPlayer.on(AudioPlayerStatus.Idle, () => void this.handleIdle());
    this.audioPlayer.on("error", (error) => {
      console.error(`Audio player error in guild ${this.guild.id}:`, error);
      this.endAction = "skip";
      if (!this.audioPlayer.stop(true)) void this.handleIdle();
    });
  }

  get voiceChannelId(): string | null {
    return this.connection?.joinConfig.channelId ?? null;
  }

  get snapshot(): PlayerSnapshot {
    return {
      current: this.current,
      queue: [...this.queue],
      historyCount: this.history.length,
      loopCurrent: this.loopCurrent,
      volume: this.volume,
      paused: this.audioPlayer.state.status === AudioPlayerStatus.Paused,
      voiceChannelId: this.voiceChannelId,
    };
  }

  async setPanelMessage(message: Message): Promise<void> {
    this.panelMessage = message;
    await this.updatePanel();
  }

  async enqueue(track: Track, voiceChannel: VoiceBasedChannel): Promise<number> {
    await this.connect(voiceChannel);
    this.queue.push(track);
    const position = this.current ? this.queue.length : 0;
    await this.updatePanel();
    if (!this.current && !this.startingTrack) await this.playNext();
    return position;
  }

  togglePause(): "paused" | "playing" | "idle" {
    if (this.audioPlayer.state.status === AudioPlayerStatus.Paused) {
      this.audioPlayer.unpause();
      void this.updatePanel();
      return "playing";
    }
    if (this.audioPlayer.state.status === AudioPlayerStatus.Playing) {
      this.audioPlayer.pause(true);
      void this.updatePanel();
      return "paused";
    }
    return "idle";
  }

  skip(): boolean {
    if (!this.current) return false;
    this.endAction = "skip";
    return this.audioPlayer.stop(true);
  }

  previous(): boolean {
    if (!this.current || this.history.length === 0) return false;
    this.endAction = "previous";
    return this.audioPlayer.stop(true);
  }

  stop(): boolean {
    const hadMusic = Boolean(this.current || this.queue.length);
    this.queue.length = 0;
    this.loopCurrent = false;
    this.endAction = "stop";
    this.stopAudioProcess();
    this.audioPlayer.stop(true);
    this.current = null;
    this.connection?.destroy();
    this.connection = null;
    void this.updatePanel();
    return hadMusic;
  }

  shuffle(): boolean {
    if (this.queue.length < 2) return false;
    for (let index = this.queue.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [this.queue[index], this.queue[target]] = [this.queue[target]!, this.queue[index]!];
    }
    void this.updatePanel();
    return true;
  }

  toggleLoop(): boolean {
    this.loopCurrent = !this.loopCurrent;
    void this.updatePanel();
    return this.loopCurrent;
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(100, Math.round(value)));
    if (this.audioPlayer.state.status !== AudioPlayerStatus.Idle) {
      this.audioPlayer.state.resource.volume?.setVolume(this.volume / 100);
    }
    void this.updatePanel();
  }

  queueDescription(): string {
    const current = this.current ? `Đang phát: **${this.current.title}**` : "Chưa phát bài nào.";
    if (this.queue.length === 0) return `${current}\nHàng chờ đang trống.`;
    const upcoming = this.queue.slice(0, 10).map((track, index) => `${index + 1}. ${track.title}`).join("\n");
    const remaining = this.queue.length > 10 ? `\n…và ${this.queue.length - 10} bài khác.` : "";
    return `${current}\n\n${upcoming}${remaining}`;
  }

  private async connect(channel: VoiceBasedChannel): Promise<void> {
    if (this.connection?.joinConfig.channelId === channel.id) return;
    if (this.connection) this.connection.destroy();
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: this.guild.id,
      adapterCreator: this.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: true,
    });
    this.connection.subscribe(this.audioPlayer);

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      this.connection.destroy();
      this.connection = null;
      throw new Error("Không thể kết nối voice channel. Kiểm tra quyền Connect/Speak.", { cause: error });
    }
  }

  private async playNext(): Promise<void> {
    if (this.startingTrack || this.current) return;
    const next = this.queue.shift();
    if (!next) {
      await this.updatePanel();
      return;
    }

    this.startingTrack = true;
    this.current = next;
    this.endAction = "normal";
    try {
      this.audioProcess = createYoutubeAudioProcess(next.url);
      const resource = createAudioResource(this.audioProcess.stream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
        metadata: next,
      });
      resource.volume?.setVolume(this.volume / 100);
      this.audioPlayer.play(resource);
      await this.updatePanel();
    } catch (error) {
      console.error(`Cannot play ${next.url}:`, error);
      this.history.push(next);
      this.current = null;
      this.stopAudioProcess();
      await this.updatePanel();
      queueMicrotask(() => void this.playNext());
    } finally {
      this.startingTrack = false;
    }
  }

  private async handleIdle(): Promise<void> {
    if (this.handlingIdle || !this.current) return;
    this.handlingIdle = true;
    try {
      const finished = this.current;
      const action = this.endAction;
      this.current = null;
      this.endAction = "normal";
      this.stopAudioProcess();

      if (action === "stop") {
        await this.updatePanel();
        return;
      }
      if (action === "previous") {
        const previous = this.history.pop();
        this.queue.unshift(finished);
        if (previous) this.queue.unshift(previous);
      } else if (action === "normal" && this.loopCurrent) {
        this.queue.unshift(finished);
      } else {
        this.history.push(finished);
        if (this.history.length > 50) this.history.shift();
      }
      await this.updatePanel();
    } finally {
      this.handlingIdle = false;
    }
    await this.playNext();
  }

  private stopAudioProcess(): void {
    this.audioProcess?.stop();
    this.audioProcess = null;
  }

  private async updatePanel(): Promise<void> {
    if (!this.panelMessage) return;
    try {
      await this.panelMessage.edit(createPlayerPanel(this.snapshot));
    } catch (error) {
      console.error(`Cannot update music panel in guild ${this.guild.id}:`, error);
      this.panelMessage = null;
    }
  }
}

export class MusicManager {
  private readonly players = new Map<string, GuildMusicPlayer>();

  get(guild: Guild): GuildMusicPlayer {
    let player = this.players.get(guild.id);
    if (!player) {
      player = new GuildMusicPlayer(guild);
      this.players.set(guild.id, player);
    }
    return player;
  }

  find(guildId: string): GuildMusicPlayer | undefined {
    return this.players.get(guildId);
  }
}
