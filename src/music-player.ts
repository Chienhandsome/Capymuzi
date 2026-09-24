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
import { config } from "./config.js";
import { historyStore } from "./history-store.js";
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
  notice: string | null;
}

type EndAction = "normal" | "skip" | "previous" | "stop";

export class GuildMusicPlayer {
  private readonly audioPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  private readonly queue: Track[] = [];
  private readonly history: Track[] = [];
  private readonly retryCounts = new Map<string, number>();
  private current: Track | null = null;
  private connection: VoiceConnection | null = null;
  private audioProcess: YoutubeAudioProcess | null = null;
  private panelMessage: Message | null = null;
  private loopCurrent = false;
  private volume = 50;
  private endAction: EndAction = "normal";
  private handlingIdle = false;
  private startingTrack = false;
  private currentRecorded = false;
  private idleDisconnectTimer: NodeJS.Timeout | null = null;
  private emptyChannelTimer: NodeJS.Timeout | null = null;
  private notice: string | null = null;

  constructor(private readonly guild: Guild) {
    this.audioPlayer.on(AudioPlayerStatus.Idle, () => void this.handleIdle());
    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      if (!this.current || this.currentRecorded) return;
      this.currentRecorded = true;
      if (this.notice) {
        this.notice = null;
        void this.updatePanel();
      }
      void historyStore.record(this.guild.id, this.current).catch((error) => {
        console.error(`Cannot save play history in guild ${this.guild.id}:`, error);
      });
    });
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
      notice: this.notice,
    };
  }

  async setPanelMessage(message: Message): Promise<void> {
    this.panelMessage = message;
    await this.updatePanel();
  }

  async enqueue(track: Track, voiceChannel: VoiceBasedChannel): Promise<number> {
    this.clearIdleDisconnectTimer();
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

  stop(notice: string | null = null): boolean {
    const hadMusic = Boolean(this.current || this.queue.length);
    this.clearDisconnectTimers();
    this.queue.length = 0;
    this.loopCurrent = false;
    this.endAction = "stop";
    this.stopAudioProcess();
    this.audioPlayer.stop(true);
    this.current = null;
    this.connection?.destroy();
    this.connection = null;
    this.notice = notice;
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

  syncListenerPresence(): void {
    const channelId = this.voiceChannelId;
    if (!channelId) {
      this.clearEmptyChannelTimer();
      return;
    }

    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isVoiceBased()) return;
    const hasHumanListener = channel.members.some((member) => !member.user.bot);
    if (hasHumanListener) {
      this.clearEmptyChannelTimer();
      return;
    }
    if (this.emptyChannelTimer) return;

    this.emptyChannelTimer = setTimeout(() => {
      this.emptyChannelTimer = null;
      const currentChannelId = this.voiceChannelId;
      const currentChannel = currentChannelId ? this.guild.channels.cache.get(currentChannelId) : null;
      if (!currentChannel?.isVoiceBased()) return;
      if (currentChannel.members.some((member) => !member.user.bot)) return;
      this.stop("Đã dừng nhạc vì voice channel không còn người nghe.");
    }, config.emptyChannelDisconnectMs);
  }

  shutdown(): void {
    this.panelMessage = null;
    this.clearDisconnectTimers();
    this.queue.length = 0;
    this.current = null;
    this.endAction = "stop";
    this.stopAudioProcess();
    this.audioPlayer.stop(true);
    this.connection?.destroy();
    this.connection = null;
  }

  private async connect(channel: VoiceBasedChannel): Promise<void> {
    if (this.connection?.joinConfig.channelId === channel.id) {
      this.syncListenerPresence();
      return;
    }
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
      this.syncListenerPresence();
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
      this.scheduleIdleDisconnect();
      await this.updatePanel();
      return;
    }

    this.startingTrack = true;
    this.current = next;
    this.currentRecorded = false;
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
      const streamFailure = this.audioProcess?.failure ?? null;
      this.current = null;
      this.endAction = "normal";
      this.stopAudioProcess();

      if (action === "stop") {
        await this.updatePanel();
        return;
      }
      if (action === "normal" && streamFailure) {
        const retryCount = this.retryCounts.get(finished.id) ?? 0;
        if (retryCount < 2) {
          this.retryCounts.set(finished.id, retryCount + 1);
          console.warn(`Retrying ${finished.title} after yt-dlp failure (${retryCount + 1}/2).`);
          this.notice = `YouTube từ chối stream **${finished.title}**. Đang thử lại (${retryCount + 1}/2)…`;
          this.queue.unshift(finished);
        } else {
          this.retryCounts.delete(finished.id);
          this.history.push(finished);
          console.error(`Giving up ${finished.title} after 2 retries: ${streamFailure}`);
          this.notice = `Không thể phát **${finished.title}** sau 2 lần thử. Bot đã chuyển sang bài tiếp theo.`;
        }
      } else if (action === "previous") {
        this.retryCounts.delete(finished.id);
        const previous = this.history.pop();
        this.queue.unshift(finished);
        if (previous) this.queue.unshift(previous);
      } else if (action === "normal" && this.loopCurrent) {
        this.retryCounts.delete(finished.id);
        this.queue.unshift(finished);
      } else {
        this.retryCounts.delete(finished.id);
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

  private scheduleIdleDisconnect(): void {
    if (!this.connection || this.current || this.queue.length > 0 || this.idleDisconnectTimer) return;
    this.idleDisconnectTimer = setTimeout(() => {
      this.idleDisconnectTimer = null;
      if (!this.connection || this.current || this.queue.length > 0) return;
      this.clearEmptyChannelTimer();
      this.connection.destroy();
      this.connection = null;
      this.notice = "Đã rời voice channel vì queue trống quá lâu.";
      void this.updatePanel();
    }, config.idleDisconnectMs);
  }

  private clearIdleDisconnectTimer(): void {
    if (this.idleDisconnectTimer) clearTimeout(this.idleDisconnectTimer);
    this.idleDisconnectTimer = null;
  }

  private clearEmptyChannelTimer(): void {
    if (this.emptyChannelTimer) clearTimeout(this.emptyChannelTimer);
    this.emptyChannelTimer = null;
  }

  private clearDisconnectTimers(): void {
    this.clearIdleDisconnectTimer();
    this.clearEmptyChannelTimer();
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

  shutdown(): void {
    for (const player of this.players.values()) player.shutdown();
    this.players.clear();
  }
}
