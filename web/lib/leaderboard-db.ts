import { env } from "cloudflare:workers";

export type LeaderboardEntry = {
  account_hash: string;
  display_name: string;
  avatar_data_url: string;
  all_time_tokens: number;
  all_time_cost_cents: number;
  today_tokens: number;
  today_cost_cents: number;
  today_date: string;
  updated_at: number;
};

let schemaReady: Promise<void> | null = null;

export async function ensureLeaderboardSchema() {
  schemaReady ??= (async () => {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS leaderboard_entries (
        account_hash TEXT PRIMARY KEY,
        device_token_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar_data_url TEXT NOT NULL DEFAULT '',
        all_time_tokens INTEGER NOT NULL DEFAULT 0,
        all_time_cost_cents INTEGER NOT NULL DEFAULT 0,
        today_tokens INTEGER NOT NULL DEFAULT 0,
        today_cost_cents INTEGER NOT NULL DEFAULT 0,
        today_date TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_device_token ON leaderboard_entries(device_token_hash)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_leaderboard_all_tokens ON leaderboard_entries(all_time_tokens DESC)"),
    ]);
  })();
  return schemaReady;
}

export function getLeaderboardDb() {
  return env.DB;
}

export async function sha256(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function cleanDisplayName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 40) : "";
}

export function cleanAvatar(value: unknown) {
  if (typeof value !== "string" || value.length > 500_000) return "";
  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : "";
}

export function cleanCounter(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(value)))
    : 0;
}
