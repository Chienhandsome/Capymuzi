import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

export function createPlayerPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Music Player")
    .setDescription("Chưa có bài nào. Dùng nút **Thêm nhạc** để tìm theo tên hoặc dán link YouTube.")
    .addFields({ name: "Hàng chờ", value: "Trống" })
    .setFooter({ text: "MVP · YouTube" });

  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("music:previous").setEmoji("⏮️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:pause").setEmoji("⏯️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("music:skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("music:shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary),
  );

  const options = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("music:add").setLabel("Thêm nhạc").setEmoji("➕").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("music:queue").setLabel("Queue").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:loop").setLabel("Loop: Tắt").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:volume").setLabel("Âm lượng").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [controls, options] };
}
