import { Client, Events, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import { createPlayerPanel } from "./player-panel.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "music") {
    await interaction.reply(createPlayerPanel());
    return;
  }

  if (interaction.isButton()) {
    await interaction.reply({
      content: "UI đã kết nối. Chức năng phát nhạc sẽ được bổ sung ở bước tiếp theo.",
      ephemeral: true,
    });
  }
});

await client.login(config.token);
