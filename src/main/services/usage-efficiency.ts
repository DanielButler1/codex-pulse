import type { ModelUsageRollup } from "../db";
import type { UsageEfficiencySummary, UsageEfficiencyWeek, UsageSnapshot } from "../../../shared/types";

const RESET_KEY_MS = 5 * 60 * 1000;
const ROLLUP_BUCKET_MS = 5 * 60 * 1000;
const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
const WEEKLY_WINDOW_TOLERANCE_MINUTES = 60;
const MIN_OBSERVED_USAGE_PERCENT = 5;
const HEADLINE_WINDOW_COUNT = 8;

type EfficiencyCandidate = UsageEfficiencyWeek & {
  intervalFrom: number;
  intervalTo: number;
  evidenceScore: number;
};

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
      snapshot.secondaryUsedPercent < 0 ||
      snapshot.secondaryUsedPercent > 100 ||
      snapshot.secondaryResetAfterSeconds == null ||
      snapshot.secondaryWindowMinutes == null ||
      Math.abs(snapshot.secondaryWindowMinutes - WEEKLY_WINDOW_MINUTES) > WEEKLY_WINDOW_TOLERANCE_MINUTES
    ) continue;
    const resetAt = snapshot.checkedAt + snapshot.secondaryResetAfterSeconds * 1000;
    const resetKey = Math.round(resetAt / RESET_KEY_MS) * RESET_KEY_MS;
    const group = byReset.get(resetKey) ?? [];
    group.push(snapshot);
    byReset.set(resetKey, group);
  }

  const candidates: EfficiencyCandidate[] = [];
  for (const [resetAt, group] of byReset) {
    const ordered = group.sort((a, b) => a.checkedAt - b.checkedAt);
    if (ordered.length < 2) continue;
    const movement = strongestForwardMovement(ordered);
    if (movement.observedUsagePercent < MIN_OBSERVED_USAGE_PERCENT) continue;
    candidates.push({
      resetAt,
      observedFrom: movement.observedFrom,
      observedTo: movement.observedTo,
      observedUsagePercent: movement.observedUsagePercent,
      totalTokens: 0,
      tokensPerPercent: null,
      projectedWeeklyTokens: null,
      observations: ordered.length,
      intervalFrom: ordered[0].checkedAt,
      intervalTo: ordered[ordered.length - 1].checkedAt,
      evidenceScore: movement.observedUsagePercent * Math.log2(ordered.length + 1),
    });
  }

  const weeks = selectNonOverlappingCandidates(candidates).map((candidate) => {
    const totalTokens = rollups.reduce(
      (sum, row) =>
        row.bucketStart + ROLLUP_BUCKET_MS > candidate.observedFrom && row.bucketStart <= candidate.observedTo
          ? sum + row.totalTokens
          : sum,
      0,
    );
    const tokensPerPercent = totalTokens > 0 ? totalTokens / candidate.observedUsagePercent : null;
    return {
      resetAt: candidate.resetAt,
      observedFrom: candidate.observedFrom,
      observedTo: candidate.observedTo,
      observedUsagePercent: candidate.observedUsagePercent,
      totalTokens,
      tokensPerPercent,
      projectedWeeklyTokens: tokensPerPercent == null ? null : tokensPerPercent * 100,
      observations: candidate.observations,
    };
  });
  return summarizeUsageEfficiency(weeks, generatedAt);
}

export function summarizeUsageEfficiency(
  weeks: UsageEfficiencyWeek[],
  generatedAt = Date.now(),
): UsageEfficiencySummary {
  const ordered = [...weeks].sort((a, b) => b.resetAt - a.resetAt);
  const usable = ordered.filter((week) => week.tokensPerPercent != null).slice(0, HEADLINE_WINDOW_COUNT);
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
    estimateWeeks: usable.length,
    weeks: ordered,
  };
}

function strongestForwardMovement(ordered: UsageSnapshot[]): {
  observedFrom: number;
  observedTo: number;
  observedUsagePercent: number;
} {
  let minimum = ordered[0].secondaryUsedPercent!;
  let minimumAt = ordered[0].checkedAt;
  let observedFrom = minimumAt;
  let observedTo = minimumAt;
  let observedUsagePercent = 0;
  for (const snapshot of ordered.slice(1)) {
    const used = snapshot.secondaryUsedPercent!;
    if (used < minimum) {
      minimum = used;
      minimumAt = snapshot.checkedAt;
      continue;
    }
    const increase = used - minimum;
    if (increase > observedUsagePercent) {
      observedUsagePercent = increase;
      observedFrom = minimumAt;
      observedTo = snapshot.checkedAt;
    }
  }
  return { observedFrom, observedTo, observedUsagePercent: Math.min(100, observedUsagePercent) };
}

function selectNonOverlappingCandidates(candidates: EfficiencyCandidate[]): EfficiencyCandidate[] {
  const ordered = [...candidates].sort((a, b) => a.intervalTo - b.intervalTo);
  const predecessors = ordered.map((candidate, index) => {
    let low = 0;
    let high = index - 1;
    let result = -1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (ordered[middle].intervalTo <= candidate.intervalFrom) {
        result = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return result;
  });
  const scores = new Array<number>(ordered.length + 1).fill(0);
  for (let index = 0; index < ordered.length; index += 1) {
    scores[index + 1] = Math.max(
      scores[index],
      ordered[index].evidenceScore + scores[predecessors[index] + 1],
    );
  }
  const selected: EfficiencyCandidate[] = [];
  for (let index = ordered.length - 1; index >= 0;) {
    const withCandidate = ordered[index].evidenceScore + scores[predecessors[index] + 1];
    if (withCandidate > scores[index]) {
      selected.push(ordered[index]);
      index = predecessors[index];
    } else {
      index -= 1;
    }
  }
  return selected.reverse();
}
