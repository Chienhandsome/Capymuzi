import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { youtubeDl } from "youtube-dl-exec";
import { config } from "./config.js";

const require = createRequire(import.meta.url);
const youtubeDlPackage = require("youtube-dl-exec") as {
  constants: { YOUTUBE_DL_PATH: string };
};

function createCookiesFile(): string | null {
  if (!config.youtubeCookiesBase64) return null;

  let cookies: string;
  try {
    cookies = Buffer.from(config.youtubeCookiesBase64, "base64").toString("utf8");
  } catch {
    throw new Error("YTDLP_COOKIES_B64 phải là nội dung cookies.txt được mã hóa base64.");
  }

  if (!/youtube\.com/i.test(cookies)) {
    throw new Error("YTDLP_COOKIES_B64 không chứa cookie YouTube hợp lệ.");
  }

  // Browser exports from Windows commonly use CRLF, while yt-dlp in the Linux
  // container expects a Netscape cookie file with Unix newlines.
  cookies = cookies.replace(/\r\n?/g, "\n");

  const directory = mkdtempSync(join(tmpdir(), "capymuzi-youtube-"));
  const path = join(directory, "cookies.txt");
  writeFileSync(path, cookies, { encoding: "utf8", mode: 0o600 });
  return path;
}

const cookiesPath = createCookiesFile();
const cookiesArgs = cookiesPath ? ["--cookies", cookiesPath] : [];

export interface Track {
  id: string;
  title: string;
  url: string;
  durationSeconds: number | null;
  thumbnail: string | null;
  channel: string | null;
  requestedBy: string;
}

interface YoutubeInfo {
  id?: string;
  title?: string;
  webpage_url?: string;
  original_url?: string;
  duration?: number;
  thumbnail?: string;
  channel?: string;
  uploader?: string;
  entries?: YoutubeInfo[];
}

export interface YoutubeAudioProcess {
  stream: Readable;
  readonly failure: string | null;
  stop(): void;
}

function isYoutubeUrl(input: string): boolean {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
}

function looksLikeUrl(input: string): boolean {
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}

function parseInfo(raw: unknown): YoutubeInfo {
  if (typeof raw === "string") return JSON.parse(raw) as YoutubeInfo;
  return raw as YoutubeInfo;
}

function friendlyYoutubeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/private video/i.test(raw)) return "Video này đang ở chế độ riêng tư.";
  if (/members-only|join this channel/i.test(raw)) return "Video này chỉ dành cho thành viên của kênh YouTube.";
  if (/age.?restricted|confirm your age|sign in to confirm your age/i.test(raw)) {
    return "Video này bị giới hạn độ tuổi và bot không thể truy cập.";
  }
  if (/sign in to confirm you.?re not a bot/i.test(raw)) {
    return "YouTube đã chặn IP cloud của bot. Chủ bot cần cấu hình YTDLP_COOKIES_B64.";
  }
  if (/not available in your country|geo.?restrict|blocked in your country/i.test(raw)) {
    return "Video này bị chặn theo khu vực của máy đang chạy bot.";
  }
  if (/copyright|removed by the uploader|video unavailable/i.test(raw)) {
    return "Video không còn khả dụng hoặc đã bị hạn chế bản quyền.";
  }
  if (/HTTP Error 403|Forbidden/i.test(raw)) {
    return "YouTube từ chối truy cập video này (HTTP 403). Hãy thử một video khác.";
  }
  if (/no video results|no matches|entries.*null/i.test(raw)) {
    return "Không tìm thấy video phù hợp trên YouTube.";
  }
  return "Không thể lấy thông tin video từ YouTube. Hãy thử lại sau.";
}

export async function resolveTrack(input: string, requestedBy: string): Promise<Track> {
  const query = input.trim();
  if (!query) throw new Error("Tên bài hát hoặc link không được để trống.");
  if (looksLikeUrl(query) && !isYoutubeUrl(query)) {
    throw new Error("MVP hiện chỉ hỗ trợ link YouTube.");
  }

  const target = isYoutubeUrl(query) ? query : `ytsearch1:${query}`;
  let raw: unknown;
  try {
    raw = await youtubeDl(target, {
      dumpSingleJson: true,
      skipDownload: true,
      noWarnings: true,
      noPlaylist: true,
      playlistItems: "1",
      jsRuntimes: "node",
      ...(cookiesPath ? { cookies: cookiesPath } : {}),
    });
  } catch (error) {
    console.error(`Cannot resolve YouTube query "${query}":`, error);
    throw new Error(friendlyYoutubeError(error), { cause: error });
  }

  const root = parseInfo(raw);
  const info = root.entries?.find(Boolean) ?? root;
  if (!info.id || !info.title) throw new Error("Không tìm thấy video phù hợp trên YouTube.");

  return {
    id: info.id,
    title: info.title,
    url: info.webpage_url ?? info.original_url ?? `https://www.youtube.com/watch?v=${info.id}`,
    durationSeconds: typeof info.duration === "number" ? info.duration : null,
    thumbnail: info.thumbnail ?? `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`,
    channel: info.channel ?? info.uploader ?? null,
    requestedBy,
  };
}

export function createYoutubeAudioProcess(url: string): YoutubeAudioProcess {
  const subprocess = spawn(youtubeDlPackage.constants.YOUTUBE_DL_PATH, [
    ...cookiesArgs,
    "--output", "-",
    "--format", "bestaudio[protocol=m3u8_native]/bestaudio[protocol=m3u8]/bestaudio[ext=webm][acodec=opus]/bestaudio/best",
    "--no-playlist",
    "--no-progress",
    "--no-warnings",
    "--quiet",
    "--force-ipv4",
    "--retries", "3",
    "--fragment-retries", "3",
    "--retry-sleep", "1",
    "--js-runtimes", "node",
    "--remote-components", "ejs:github",
    "--",
    url,
  ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  let failure: string | null = null;
  let intentionallyStopped = false;
  subprocess.stderr.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
    if (stderr.length > 4_000) stderr = stderr.slice(-4_000);
    if (/ERROR:|HTTP Error 403/i.test(stderr)) failure = stderr.trim();
  });
  subprocess.once("close", (code) => {
    if (!intentionallyStopped && code && code !== 0) {
      failure = stderr.trim() || `yt-dlp exited with code ${code}`;
      console.error(`yt-dlp exited with code ${code}: ${failure}`);
    }
  });
  subprocess.once("error", (error) => {
    failure = error.message;
    console.error("Cannot start yt-dlp:", error);
  });

  return {
    stream: subprocess.stdout,
    get failure() {
      return failure;
    },
    stop: () => {
      intentionallyStopped = true;
      if (!subprocess.killed) subprocess.kill();
    },
  };
}
