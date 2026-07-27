import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";
type Raw = Record<string, any>;
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const endpoint = process.env.CODEX_USAGE_ENDPOINT || "https://chatgpt.com/backend-api/wham/usage";
  const token = process.env.CODEX_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ checkedAt:null, primaryUsedPercent:null, secondaryUsedPercent:null, primaryResetAt:null, secondaryResetAt:null, burnRatePerHour:null, models:[], history:[], providers:[], source:"Not configured", error:"Live Codex access is not configured for this private site. Add CODEX_ACCESS_TOKEN as a hosted runtime secret; local rollout logs stay on the desktop." });
  try {
    const response = await fetch(endpoint, { headers:{ Authorization:`Bearer ${token}`, Accept:"application/json" }, cache:"no-store" });
    if (!response.ok) throw new Error(`Telemetry source returned ${response.status}.`);
    const raw = await response.json() as Raw;
    const primary = raw.rate_limit?.primary_window ?? raw.primary_window ?? raw.rateLimit?.primaryWindow ?? {};
    const secondary = raw.rate_limit?.secondary_window ?? raw.secondary_window ?? raw.rateLimit?.secondaryWindow ?? {};
    return NextResponse.json({ checkedAt:Date.now(), primaryUsedPercent:num(primary.used_percent ?? primary.usedPercent), secondaryUsedPercent:num(secondary.used_percent ?? secondary.usedPercent), primaryResetAt:num(primary.reset_at ?? primary.resetAt) ? Number(primary.reset_at ?? primary.resetAt) * 1000 : null, secondaryResetAt:num(secondary.reset_at ?? secondary.resetAt) ? Number(secondary.reset_at ?? secondary.resetAt) * 1000 : null, burnRatePerHour:null, models:[], history:[], providers:[{name:"Codex",status:"Connected",detail:"Usage endpoint"}], source:"Live", error:null });
  } catch (error) { return NextResponse.json({ checkedAt:Date.now(), primaryUsedPercent:null, secondaryUsedPercent:null, primaryResetAt:null, secondaryResetAt:null, burnRatePerHour:null, models:[], history:[], providers:[{name:"Codex",status:"Unavailable",detail:"Check runtime credentials"}], source:"Error", error:error instanceof Error ? error.message : "Telemetry source failed." }); }
}
