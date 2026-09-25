import "dotenv/config";

const required = ["DISCORD_CLIENT_ID", "DISCORD_GUILD_ID", "DISCORD_BOT_TOKEN"] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing ${key}. Copy .env.example to .env and fill in its value.`);
  }
}

export const config = {
  clientId: process.env.DISCORD_CLIENT_ID!,
  guildId: process.env.DISCORD_GUILD_ID!,
  token: process.env.DISCORD_BOT_TOKEN!,
  idleDisconnectMs: Number(process.env.IDLE_DISCONNECT_MS) || 300_000,
  emptyChannelDisconnectMs: Number(process.env.EMPTY_CHANNEL_DISCONNECT_MS) || 60_000,
  // A base64-encoded Netscape cookies.txt file. This lets a cloud-hosted
  // yt-dlp instance authenticate without putting a cookie file in the image.
  youtubeCookiesBase64: process.env.YTDLP_COOKIES_B64?.trim() || null,
  host: process.env.HOST?.trim() || "0.0.0.0",
  port: Number(process.env.PORT) || 3_000,
};
