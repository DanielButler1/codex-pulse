import { ensureLeaderboardSchema, getLeaderboardDb, type LeaderboardEntry } from "../../../lib/leaderboard-db";

export async function GET() {
  await ensureLeaderboardSchema();
  const result = await getLeaderboardDb().prepare(`SELECT account_hash, display_name, avatar_data_url,
    all_time_tokens, all_time_cost_cents, today_tokens, today_cost_cents, today_date, updated_at
    FROM leaderboard_entries ORDER BY all_time_tokens DESC LIMIT 100`).all<LeaderboardEntry>();
  return Response.json({ entries: result.results });
}
