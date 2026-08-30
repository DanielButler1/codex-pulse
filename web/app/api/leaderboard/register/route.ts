import { cleanAvatar, cleanDisplayName, ensureLeaderboardSchema, getLeaderboardDb } from "../../../../lib/leaderboard-db";

export async function POST(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const accountHash = typeof body.accountHash === "string" ? body.accountHash : "";
  const deviceTokenHash = typeof body.deviceTokenHash === "string" ? body.deviceTokenHash : "";
  const displayName = cleanDisplayName(body.displayName);
  const avatarDataUrl = cleanAvatar(body.avatarDataUrl);
  if (!/^[a-f0-9]{64}$/.test(accountHash) || !/^[a-f0-9]{64}$/.test(deviceTokenHash) || !displayName) {
    return Response.json({ error: "Invalid leaderboard registration." }, { status: 400 });
  }

  await ensureLeaderboardSchema();
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  await getLeaderboardDb().prepare(`INSERT INTO leaderboard_entries (
    account_hash, device_token_hash, display_name, avatar_data_url, today_date, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(account_hash) DO UPDATE SET
    device_token_hash = excluded.device_token_hash,
    display_name = excluded.display_name,
    avatar_data_url = excluded.avatar_data_url,
    updated_at = excluded.updated_at`).bind(
      accountHash, deviceTokenHash, displayName, avatarDataUrl, today, now,
    ).run();
  return Response.json({ registered: true });
}
