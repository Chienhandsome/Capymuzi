import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { config } from "./config.js";

const commands = [
  new SlashCommandBuilder()
    .setName("music")
    .setDescription("Mở bảng điều khiển nhạc"),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
console.log("Registered /music for the test server.");
