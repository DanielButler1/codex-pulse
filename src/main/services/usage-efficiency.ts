import type { ModelUsageRollup } from "../db";
import type { UsageEfficiencySummary, UsageEfficiencyWeek, UsageSnapshot } from "../../../shared/types";

const RESET_KEY_MS = 5 * 60 * 1000;
const ROLLUP_BUCKET_MS = 5 * 60 * 1000;

export function calculateUsageEfficiency(
  snapshots: UsageSnapshot[],
  rollups: ModelUsageRollup[],
  generatedAt = Date.now(),
): UsageEfficiencySummary {
  const byReset = new Map<number, UsageSnapshot[]>();
  for (const snapshot of snapshots) {
    if (
      snapshot.secondaryUsedPercent == null ||
      !Number.isFinite(snapshot.secondaryUsedPercent) ||
      snapshot.secondaryResetAfterSeconds == null
    ) continue;
    const resetAt = snapshot.checkedAt + snapshot.secondaryResetAfterSeconds * 1000;
    const resetKey = Math.round(resetAt / RESET_KEY_MS) * RESET_KEY_MS;
    const group = byReset.get(resetKey) ?? [];
    group.push(snapshot);
    byReset.set(resetKey, group);
  }

  const weeks: UsageEfficiencyWeek[] = [];
  for (const [resetAt, group] of byReset) {
    const ordered = group.sort((a, b) => a.checkedAt - b.checkedAt);
    if (ordered.length < 2) continue;
    let observedUsagePercent = 0;
    for (let index = 1; index < ordered.length; index += 1) {
      const increase = ordered[index].secondaryUsedPercent! - ordered[index - 1].secondaryUsedPercent!;
      if (increase > 0) observedUsagePercent += increase;
    }
    const observedFrom = ordered[0].checkedAt;
    const observedTo = ordered[ordered.length - 1].checkedAt;
    const totalTokens = rollups.reduce(
      (sum, row) =>
        row.bucketStart + ROLLUP_BUCKET_MS > observedFrom && row.bucketStart <= observedTo
          ? sum + row.totalTokens
          : sum,
      0,
    );
    const tokensPerPercent = observedUsagePercent > 0 && totalTokens > 0
      ? totalTokens / observedUsagePercent
      : null;
    weeks.push({
      resetAt,
      observedFrom,
      observedTo,
      observedUsagePercent,
      totalTokens,
      tokensPerPercent,
      projectedWeeklyTokens: tokensPerPercent == null ? null : tokensPerPercent * 100,
      observations: ordered.length,
    });
  }
  weeks.sort((a, b) => b.resetAt - a.resetAt);
  const usable = weeks.filter((week) => week.tokensPerPercent != null);
  const observedUsagePercent = usable.reduce((sum, week) => sum + week.observedUsagePercent, 0);
  const totalTokens = usable.reduce((sum, week) => sum + week.totalTokens, 0);
  const tokensPerPercent = observedUsagePercent > 0 ? totalTokens / observedUsagePercent : null;
  const confidence = observedUsagePercent >= 50 && usable.length >= 2
    ? "high"
    : observedUsagePercent >= 15
      ? "medium"
      : "low";

  return {
    generatedAt,
    tokensPerPercent,
    projectedWeeklyTokens: tokensPerPercent == null ? null : tokensPerPercent * 100,
    observedUsagePercent,
    totalTokens,
    confidence,
    weeks,
  };
}
