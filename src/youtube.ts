import type { Readable } from "node:stream";
import { youtubeDl } from "youtube-dl-exec";

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

export async function resolveTrack(input: string, requestedBy: string): Promise<Track> {
  const query = input.trim();
  if (!query) throw new Error("Tên bài hát hoặc link không được để trống.");
  if (looksLikeUrl(query) && !isYoutubeUrl(query)) {
    throw new Error("MVP hiện chỉ hỗ trợ link YouTube.");
  }

  const target = isYoutubeUrl(query) ? query : `ytsearch1:${query}`;
  const raw = await youtubeDl(target, {
    dumpSingleJson: true,
    skipDownload: true,
    noWarnings: true,
    noPlaylist: true,
    playlistItems: "1",
    jsRuntimes: "node",
  });

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
  const subprocess = youtubeDl.exec(
    url,
    {
      output: "-",
      format: "bestaudio[ext=webm][acodec=opus]/bestaudio/best",
      noPlaylist: true,
      noProgress: true,
      noWarnings: true,
      quiet: true,
      jsRuntimes: "node",
    },
    { windowsHide: true },
  );

  if (!subprocess.stdout) {
    subprocess.kill();
    throw new Error("Không mở được audio stream từ YouTube.");
  }

  let stderr = "";
  subprocess.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
    if (stderr.length > 4_000) stderr = stderr.slice(-4_000);
  });
  subprocess.once("close", (code) => {
    if (code && code !== 0 && stderr) console.error(`yt-dlp exited with code ${code}: ${stderr.trim()}`);
  });

  return {
    stream: subprocess.stdout,
    stop: () => {
      if (!subprocess.killed) subprocess.kill();
    },
  };
}
