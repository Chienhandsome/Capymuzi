import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import sqlite3 from "sqlite3";
import type { Track } from "./youtube.js";

export interface HistoryEntry {
  id: number;
  guildId: string;
  videoId: string;
  title: string;
  url: string;
  channel: string | null;
  durationSeconds: number | null;
  requestedBy: string;
  playedAt: string;
}

const databasePath = process.env.DATABASE_PATH?.trim() || resolve(process.cwd(), "data", "music-bot.sqlite");
if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });

const database = new sqlite3.Database(databasePath);

function exec(sql: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    database.exec(sql, (error) => error ? reject(error) : resolvePromise());
  });
}

function run(sql: string, parameters: Record<string, unknown>): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    database.run(sql, parameters, function onRun(error) {
      if (error) reject(error);
      else resolvePromise(this.changes);
    });
  });
}

function all<T>(sql: string, parameters: readonly unknown[]): Promise<T[]> {
  return new Promise((resolvePromise, reject) => {
    database.all(sql, parameters, (error, rows: T[]) => error ? reject(error) : resolvePromise(rows));
  });
}

function get<T>(sql: string, parameters: readonly unknown[]): Promise<T | undefined> {
  return new Promise((resolvePromise, reject) => {
    database.get(sql, parameters, (error, row: T | undefined) => error ? reject(error) : resolvePromise(row));
  });
}

const ready = exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    channel TEXT,
    duration_seconds INTEGER,
    requested_by TEXT NOT NULL,
    played_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_play_history_guild_played_at
    ON play_history (guild_id, played_at DESC);
`);

export const historyStore = {
  async record(guildId: string, track: Track): Promise<void> {
    await ready;
    await run(`
      INSERT INTO play_history (
        guild_id, video_id, title, url, channel, duration_seconds, requested_by
      ) VALUES (
        $guildId, $videoId, $title, $url, $channel, $durationSeconds, $requestedBy
      )
    `, {
      $guildId: guildId,
      $videoId: track.id,
      $title: track.title,
      $url: track.url,
      $channel: track.channel,
      $durationSeconds: track.durationSeconds,
      $requestedBy: track.requestedBy,
    });
  },

  async list(guildId: string, limit = 10, offset = 0): Promise<HistoryEntry[]> {
    await ready;
    const safeLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
    const safeOffset = Math.max(0, Math.trunc(offset));
    return all<HistoryEntry>(`
      SELECT
        id,
        guild_id AS guildId,
        video_id AS videoId,
        title,
        url,
        channel,
        duration_seconds AS durationSeconds,
        requested_by AS requestedBy,
        played_at AS playedAt
      FROM play_history
      WHERE guild_id = ?
      ORDER BY played_at DESC, id DESC
      LIMIT ? OFFSET ?
    `, [guildId, safeLimit, safeOffset]);
  },

  async count(guildId: string): Promise<number> {
    await ready;
    const row = await get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM play_history WHERE guild_id = ?",
      [guildId],
    );
    return row?.count ?? 0;
  },

  async clear(guildId: string): Promise<number> {
    await ready;
    return run("DELETE FROM play_history WHERE guild_id = $guildId", { $guildId: guildId });
  },

  async close(): Promise<void> {
    await ready;
    await new Promise<void>((resolvePromise, reject) => {
      database.close((error) => error ? reject(error) : resolvePromise());
    });
  },
};
