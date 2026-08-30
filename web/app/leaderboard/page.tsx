import Leaderboard from "./leaderboard";
import { ensureLeaderboardSchema, getLeaderboardDb, type LeaderboardEntry } from "../../lib/leaderboard-db";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  await ensureLeaderboardSchema();
  const result = await getLeaderboardDb().prepare(`SELECT display_name, avatar_data_url,
    all_time_tokens, all_time_cost_cents, today_tokens, today_cost_cents, today_date, updated_at
    FROM leaderboard_entries ORDER BY all_time_tokens DESC LIMIT 100`).all<LeaderboardEntry>();
  return <Leaderboard entries={result.results} />;
}
