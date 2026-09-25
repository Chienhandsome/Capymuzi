import { createServer } from "node:http";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  MessageFlags,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
} from "discord.js";
import { config } from "./config.js";
import { historyStore } from "./history-store.js";
import { MusicManager } from "./music-player.js";
import { createPlayerPanel } from "./player-panel.js";
import { resolveTrack } from "./youtube.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const music = new MusicManager();

const healthServer = createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const ready = client.isReady();
  response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
  response.end(JSON.stringify({
    status: ready ? "ok" : "starting",
    discord: ready ? client.user?.tag : null,
    uptimeSeconds: Math.floor(process.uptime()),
  }));
});

healthServer.listen(config.port, config.host, () => {
  console.log(`Health endpoint listening on http://${config.host}:${config.port}/health`);
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready as ${readyClient.user.tag}`);
});

async function getMember(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<GuildMember> {
  if (!interaction.guild) throw new Error("Tính năng này chỉ dùng được trong server.");
  return interaction.guild.members.fetch(interaction.user.id);
}

async function assertCanControl(interaction: ButtonInteraction | ModalSubmitInteraction) {
  const member = await getMember(interaction);
  if (!member.voice.channel) throw new Error("Bạn cần vào một voice channel trước.");
  const player = music.find(interaction.guildId!);
  if (player?.voiceChannelId && player.voiceChannelId !== member.voice.channel.id) {
    throw new Error("Bạn cần ở cùng voice channel với bot để điều khiển nhạc.");
  }
  return member.voice.channel;
}

function addMusicModal(): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("query")
    .setLabel("Mỗi dòng là một tên bài hoặc link YouTube")
    .setPlaceholder("Numb Linkin Park\nBohemian Rhapsody\nhttps://youtu.be/...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4000);
  return new ModalBuilder()
    .setCustomId("music:add-modal")
    .setTitle("Thêm một hoặc nhiều bài")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

const historyPageSize = 5;

async function historyMessage(guildId: string, requestedPage = 0) {
  const total = await historyStore.count(guildId);
  const pageCount = Math.max(1, Math.ceil(total / historyPageSize));
  const page = Math.max(0, Math.min(pageCount - 1, Math.trunc(requestedPage)));
  const entries = await historyStore.list(guildId, historyPageSize, page * historyPageSize);
  const description = entries.length
    ? entries.map((entry, index) => {
        const timestamp = Math.floor(new Date(entry.playedAt).getTime() / 1000);
        return `${page * historyPageSize + index + 1}. **[${entry.title.replace(/[\\[\]()*_`~>|]/g, "\\$&")}](${entry.url})**\n${entry.requestedBy} · <t:${timestamp}:R>`;
      }).join("\n\n")
    : "Chưa có bài nào trong lịch sử.";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Lịch sử phát nhạc")
    .setDescription(description)
    .setFooter({ text: `${total} lượt phát · Trang ${page + 1}/${pageCount} · SQLite` });

  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`music:history:page:${page - 1}`)
      .setLabel("Trước")
      .setEmoji("◀️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId("music:history:page-label")
      .setLabel(`${page + 1}/${pageCount}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`music:history:page:${page + 1}`)
      .setLabel("Sau")
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pageCount - 1),
    new ButtonBuilder()
      .setCustomId("music:history:clear")
      .setLabel("Xóa lịch sử")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(total === 0),
  );

  return { content: null, embeds: [embed], components: [controls] };
}

function clearHistoryConfirmation() {
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("music:history:clear-confirm")
      .setLabel("Xác nhận xóa")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("music:history:clear-cancel")
      .setLabel("Hủy")
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    content: "Bạn có chắc muốn xóa toàn bộ lịch sử phát nhạc của server này không? Thao tác này không thể hoàn tác.",
    embeds: [],
    components: [controls],
  };
}

function volumeModal(currentVolume: number): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("volume")
    .setLabel("Âm lượng từ 0 đến 100")
    .setValue(currentVolume.toString())
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3);
  return new ModalBuilder()
    .setCustomId("music:volume-modal")
    .setTitle("Điều chỉnh âm lượng")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) throw new Error("Tính năng này chỉ dùng được trong server.");
  const player = music.get(interaction.guild);

  if (interaction.customId === "music:add") {
    await assertCanControl(interaction);
    await interaction.showModal(addMusicModal());
    return;
  }
  if (interaction.customId === "music:volume") {
    await assertCanControl(interaction);
    await interaction.showModal(volumeModal(player.snapshot.volume));
    return;
  }
  if (interaction.customId === "music:queue") {
    await interaction.reply({ content: player.queueDescription(), flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.customId === "music:history") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(await historyMessage(interaction.guild.id));
    return;
  }
  if (interaction.customId.startsWith("music:history:page:")) {
    const page = Number(interaction.customId.split(":").at(-1));
    await interaction.deferUpdate();
    await interaction.editReply(await historyMessage(interaction.guild.id, Number.isFinite(page) ? page : 0));
    return;
  }
  if (interaction.customId === "music:history:clear") {
    await interaction.update(clearHistoryConfirmation());
    return;
  }
  if (interaction.customId === "music:history:clear-cancel") {
    await interaction.update(await historyMessage(interaction.guild.id));
    return;
  }
  if (interaction.customId === "music:history:clear-confirm") {
    await interaction.deferUpdate();
    const deleted = await historyStore.clear(interaction.guild.id);
    const message = await historyMessage(interaction.guild.id);
    await interaction.editReply({ ...message, content: `Đã xóa ${deleted} mục khỏi lịch sử.` });
    return;
  }

  await assertCanControl(interaction);
  let message: string;
  switch (interaction.customId) {
    case "music:pause": {
      const status = player.togglePause();
      message = status === "paused" ? "Đã tạm dừng." : status === "playing" ? "Đã tiếp tục phát." : "Hiện không có bài nào đang phát.";
      break;
    }
    case "music:skip":
      message = player.skip() ? "Đã bỏ qua bài hiện tại." : "Hiện không có bài nào đang phát.";
      break;
    case "music:previous":
      message = player.previous() ? "Đang quay lại bài trước." : "Chưa có bài trước đó.";
      break;
    case "music:stop":
      message = player.stop() ? "Đã dừng nhạc, xóa queue và rời voice channel." : "Queue đang trống.";
      break;
    case "music:shuffle":
      message = player.shuffle() ? "Đã trộn hàng chờ." : "Cần ít nhất 2 bài trong hàng chờ để trộn.";
      break;
    case "music:loop":
      message = player.toggleLoop() ? "Đã bật lặp lại bài hiện tại." : "Đã tắt lặp lại.";
      break;
    default:
      message = "Nút này chưa được hỗ trợ.";
  }
  await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) throw new Error("Tính năng này chỉ dùng được trong server.");
  const voiceChannel = await assertCanControl(interaction);
  const player = music.get(interaction.guild);

  if (interaction.customId === "music:add-modal") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const queries = interaction.fields.getTextInputValue("query")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (queries.length === 0) throw new Error("Hãy nhập ít nhất một tên bài hoặc link YouTube.");
    if (queries.length > 10) throw new Error("Mỗi lần chỉ có thể thêm tối đa 10 bài.");

    const results = await Promise.allSettled(
      queries.map((query) => resolveTrack(query, interaction.user.toString())),
    );
    const added: string[] = [];
    const failed: Array<{ query: string; reason: string }> = [];
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index]!;
      if (result.status === "fulfilled") {
        await player.enqueue(result.value, voiceChannel);
        added.push(result.value.title);
      } else {
        failed.push({
          query: queries[index]!,
          reason: result.reason instanceof Error ? result.reason.message : "Lỗi không xác định.",
        });
      }
    }

    const addedText = added.length
      ? `✅ Đã thêm ${added.length} bài:\n${added.map((title) => `• ${title}`).join("\n")}`
      : "";
    const failedText = failed.length
      ? `\n\n❌ Không thêm được ${failed.length} mục:\n${failed.map((item) => `• ${item.query}: ${item.reason}`).join("\n")}`
      : "";
    await interaction.editReply((addedText + failedText).slice(0, 2_000));
    return;
  }

  if (interaction.customId === "music:volume-modal") {
    const raw = interaction.fields.getTextInputValue("volume").trim();
    const volume = Number(raw);
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
      throw new Error("Âm lượng phải là số nguyên từ 0 đến 100.");
    }
    player.setVolume(volume);
    await interaction.reply({ content: `Đã đặt âm lượng thành ${volume}%.`, flags: MessageFlags.Ephemeral });
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "capymuzi") {
      if (!interaction.guild) throw new Error("Lệnh này chỉ dùng được trong server.");
      const player = music.get(interaction.guild);
      await interaction.reply(createPlayerPanel(player.snapshot));
      await player.setPanelMessage(await interaction.fetchReply());
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("music:")) {
      await handleButton(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("music:")) {
      await handleModal(interaction);
    }
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Đã xảy ra lỗi không xác định.";
    if (!interaction.isRepliable()) return;
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: `❌ ${message}`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    } else {
      await interaction.reply({ content: `❌ ${message}`, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const player = music.find(newState.guild.id);
  if (!player?.voiceChannelId) return;
  if (oldState.channelId === player.voiceChannelId || newState.channelId === player.voiceChannelId) {
    player.syncListenerPresence();
  }
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down gracefully...`);

  music.shutdown();
  client.destroy();
  await Promise.allSettled([
    historyStore.close(),
    new Promise<void>((resolvePromise) => healthServer.close(() => resolvePromise())),
  ]);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(config.token);
