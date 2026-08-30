import { cleanAvatar, cleanCounter, cleanDisplayName, ensureLeaderboardSchema, getLeaderboardDb, sha256 } from "../../../../lib/leaderboard-db";

async function tokenHash(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? sha256(authorization.slice(7)) : null;
}

export async function PUT(request: Request) {
  const hash = await tokenHash(request);
  if (!hash) return Response.json({ error: "Missing upload credential." }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const displayName = cleanDisplayName(body.displayName);
  if (!displayName) return Response.json({ error: "Display name is required." }, { status: 400 });

  await ensureLeaderboardSchema();
  const result = await getLeaderboardDb().prepare(`UPDATE leaderboard_entries SET
    display_name = ?, avatar_data_url = ?, all_time_tokens = ?, all_time_cost_cents = ?,
    today_tokens = ?, today_cost_cents = ?, today_date = ?, updated_at = ?
    WHERE device_token_hash = ?`).bind(
      displayName,
      cleanAvatar(body.avatarDataUrl),
      cleanCounter(body.allTimeTokens),
      cleanCounter(body.allTimeCostCents),
      cleanCounter(body.todayTokens),
      cleanCounter(body.todayCostCents),
      typeof body.todayDate === "string" ? body.todayDate.slice(0, 10) : "",
      Date.now(),
      hash,
    ).run();
  if (!result.meta.changes) return Response.json({ error: "Upload credential is not registered." }, { status: 401 });
  return Response.json({ synced: true });
}

export async function DELETE(request: Request) {
  const hash = await tokenHash(request);
  if (!hash) return Response.json({ error: "Missing upload credential." }, { status: 401 });
  await ensureLeaderboardSchema();
  await getLeaderboardDb().prepare("DELETE FROM leaderboard_entries WHERE device_token_hash = ?").bind(hash).run();
  return Response.json({ deleted: true });
}
