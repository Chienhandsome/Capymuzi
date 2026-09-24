import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import type { PlayerSnapshot } from "./music-player.js";

const emptySnapshot: PlayerSnapshot = {
  current: null,
  queue: [],
  historyCount: 0,
  loopCurrent: false,
  volume: 50,
  paused: false,
  voiceChannelId: null,
  notice: null,
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Không rõ";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function cleanMarkdown(value: string): string {
  return value.replace(/[\\[\]()*_`~>|]/g, "\\$&");
}

export function createPlayerPanel(state: PlayerSnapshot = emptySnapshot) {
  const queueText = state.queue.length
    ? state.queue.slice(0, 5).map((track, index) => `${index + 1}. ${cleanMarkdown(track.title)}`).join("\n")
      + (state.queue.length > 5 ? `\n…và ${state.queue.length - 5} bài khác` : "")
    : "Trống";
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Music Player")
    .setDescription(state.current
      ? `**[${cleanMarkdown(state.current.title)}](${state.current.url})**\n${state.current.channel ?? "YouTube"} · ${formatDuration(state.current.durationSeconds)} · yêu cầu bởi ${state.current.requestedBy}`
      : "Chưa có bài nào. Dùng nút **Thêm nhạc** để tìm theo tên hoặc dán link YouTube.")
    .addFields({ name: `Hàng chờ · ${state.queue.length} bài`, value: queueText })
    .setFooter({ text: `YouTube · Âm lượng ${state.volume}% · Loop ${state.loopCurrent ? "bật" : "tắt"}` });

  if (state.current?.thumbnail) embed.setThumbnail(state.current.thumbnail);
  if (state.notice) embed.addFields({ name: "Thông báo", value: state.notice });

  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("music:previous").setEmoji("⏮️").setStyle(ButtonStyle.Secondary).setDisabled(!state.current || state.historyCount === 0),
    new ButtonBuilder().setCustomId("music:pause").setEmoji(state.paused ? "▶️" : "⏸️").setStyle(ButtonStyle.Primary).setDisabled(!state.current),
    new ButtonBuilder().setCustomId("music:skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary).setDisabled(!state.current),
    new ButtonBuilder().setCustomId("music:stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger).setDisabled(!state.current && state.queue.length === 0),
    new ButtonBuilder().setCustomId("music:shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary).setDisabled(state.queue.length < 2),
  );

  const options = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("music:add").setLabel("Thêm nhạc").setEmoji("➕").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("music:queue").setLabel("Queue").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:loop").setLabel(`Loop: ${state.loopCurrent ? "Bật" : "Tắt"}`).setStyle(state.loopCurrent ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:volume").setLabel("Âm lượng").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:history").setLabel("Lịch sử").setEmoji("🕘").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [controls, options] };
}
