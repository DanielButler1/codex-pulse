import { createHash, randomBytes } from "node:crypto";
import type { AppSettings, LeaderboardSyncStatus, UsageSnapshot } from "../../../shared/types";
import type { UsageDatabase } from "../db";
import type { ProviderSecretsStore } from "./provider-secrets";
import { getCodexPublicIdentity } from "./codex-auth";
import { getModelUsageSummary } from "./model-usage";

const LEADERBOARD_ORIGIN = "https://codex-leaderboard.danielbutler1.chatgpt.site";
const SECRET_ID = "codex-pulse-leaderboard";

export class LeaderboardSyncService {
  private status: LeaderboardSyncStatus = { state: "disabled", lastSyncAt: null, error: null };
  private inflight: Promise<LeaderboardSyncStatus> | null = null;

  constructor(
    private readonly secrets: ProviderSecretsStore,
    private readonly db: UsageDatabase,
    private readonly getSettings: () => AppSettings,
    private readonly getLatestSnapshot: () => UsageSnapshot | null,
  ) {}

  getStatus() { return { ...this.status }; }

  sync(force = false): Promise<LeaderboardSyncStatus> {
    if (this.inflight) return this.inflight;
    const profile = this.getSettings().leaderboardProfile;
    if (!profile.sharingEnabled || !profile.displayName.trim()) {
      this.status = { ...this.status, state: "disabled", error: null };
      return Promise.resolve(this.getStatus());
    }
    if (!force && this.status.lastSyncAt && Date.now() - this.status.lastSyncAt < 55 * 60 * 1000) {
      return Promise.resolve(this.getStatus());
    }
    this.status = { ...this.status, state: "syncing", error: null };
    this.inflight = this.performSync().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async deleteEntry() {
    const token = this.secrets.getSecrets(SECRET_ID).bearerToken;
    if (token) {
      await fetch(`${LEADERBOARD_ORIGIN}/api/leaderboard/sync`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => undefined);
      this.secrets.update(SECRET_ID, { bearerToken: "" });
    }
    this.status = { state: "disabled", lastSyncAt: null, error: null };
    return this.getStatus();
  }

  private async performSync() {
    try {
      const profile = this.getSettings().leaderboardProfile;
      const identity = await getCodexPublicIdentity();
      if (!identity?.userId) throw new Error("Codex account identity is unavailable. Sign in to Codex first.");
      let uploadToken = this.secrets.getSecrets(SECRET_ID).bearerToken;
      if (!uploadToken) {
        uploadToken = randomBytes(32).toString("base64url");
        this.secrets.update(SECRET_ID, { bearerToken: uploadToken });
      }
      const accountHash = hash(identity.userId);
      const deviceTokenHash = hash(uploadToken);
      const registration = await fetch(`${LEADERBOARD_ORIGIN}/api/leaderboard/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountHash, deviceTokenHash, displayName: profile.displayName, avatarDataUrl: profile.avatarDataUrl }),
      });
      if (!registration.ok) throw new Error(`Leaderboard registration failed (${registration.status}).`);

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const usageHistory = this.db.getSnapshotsSince(0);
      const weeklyUsed = this.getLatestSnapshot()?.secondaryUsedPercent ?? null;
      const [allTime, today] = await Promise.all([
        getModelUsageSummary(this.db, "all", undefined, weeklyUsed, usageHistory),
        getModelUsageSummary(this.db, "sub_period", todayStart, weeklyUsed, usageHistory),
      ]);
      const response = await fetch(`${LEADERBOARD_ORIGIN}/api/leaderboard/sync`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${uploadToken}` },
        body: JSON.stringify({
          displayName: profile.displayName,
          avatarDataUrl: profile.avatarDataUrl,
          allTimeTokens: allTime.totals.totalTokens,
          allTimeCostCents: Math.round(allTime.totals.estimatedCostUsd * 100),
          todayTokens: today.totals.totalTokens,
          todayCostCents: Math.round(today.totals.estimatedCostUsd * 100),
          todayDate: localDateKey(now),
        }),
      });
      if (!response.ok) throw new Error(`Leaderboard upload failed (${response.status}).`);
      this.status = { state: "synced", lastSyncAt: Date.now(), error: null };
    } catch (error) {
      this.status = { ...this.status, state: "error", error: error instanceof Error ? error.message : "Leaderboard sync failed." };
    }
    return this.getStatus();
  }
}

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
