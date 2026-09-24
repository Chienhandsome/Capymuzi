import {
  ActionRowBuilder,
  Client,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
} from "discord.js";
import { config } from "./config.js";
import { MusicManager } from "./music-player.js";
import { createPlayerPanel } from "./player-panel.js";
import { resolveTrack } from "./youtube.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const music = new MusicManager();

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
    .setLabel("Tên bài hát hoặc link YouTube")
    .setPlaceholder("Ví dụ: Numb Linkin Park")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(500);
  return new ModalBuilder()
    .setCustomId("music:add-modal")
    .setTitle("Thêm nhạc")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
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
    await interaction.reply({ content: player.queueDescription(), ephemeral: true });
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
  await interaction.reply({ content: message, ephemeral: true });
}

async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) throw new Error("Tính năng này chỉ dùng được trong server.");
  const voiceChannel = await assertCanControl(interaction);
  const player = music.get(interaction.guild);

  if (interaction.customId === "music:add-modal") {
    await interaction.deferReply({ ephemeral: true });
    const query = interaction.fields.getTextInputValue("query");
    const track = await resolveTrack(query, interaction.user.toString());
    const position = await player.enqueue(track, voiceChannel);
    await interaction.editReply(position === 0
      ? `Đang phát **${track.title}**.`
      : `Đã thêm **${track.title}** vào vị trí ${position} trong hàng chờ.`);
    return;
  }

  if (interaction.customId === "music:volume-modal") {
    const raw = interaction.fields.getTextInputValue("volume").trim();
    const volume = Number(raw);
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
      throw new Error("Âm lượng phải là số nguyên từ 0 đến 100.");
    }
    player.setVolume(volume);
    await interaction.reply({ content: `Đã đặt âm lượng thành ${volume}%.`, ephemeral: true });
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "music") {
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
      await interaction.followUp({ content: `❌ ${message}`, ephemeral: true }).catch(() => undefined);
    } else {
      await interaction.reply({ content: `❌ ${message}`, ephemeral: true }).catch(() => undefined);
    }
  }
});

await client.login(config.token);
