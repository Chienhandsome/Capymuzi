import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { config } from "./config.js";

const commands = [
  new SlashCommandBuilder()
    .setName("capymuzi")
    .setDescription("Mở bảng điều khiển nhạc"),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

await rest.put(Routes.applicationCommands(config.clientId), { body: commands });

// Remove the previous server-only command so /music no longer appears in the
// original test server. The global command above is available in every server
// where the bot is installed.
await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: [] });
console.log("Registered /capymuzi globally and removed test-server commands.");
