import type { ModelUsageRollup } from "../db";
import type {
  UsageEfficiencyModelEstimate,
  UsageEfficiencySummary,
  UsageEfficiencyWeek,
  UsageSnapshot,
} from "../../../shared/types";

const RESET_KEY_MS = 5 * 60 * 1000;
const ROLLUP_BUCKET_MS = 5 * 60 * 1000;
const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
const WEEKLY_WINDOW_TOLERANCE_MINUTES = 60;
const MIN_OBSERVED_USAGE_PERCENT = 5;
const HEADLINE_WINDOW_COUNT = 8;
const MODEL_ESTIMATE_WINDOW_COUNT = 12;
const MIN_MODEL_TOKEN_SHARE = 0.03;
const MIN_MODEL_WINDOWS = 3;
const MAX_ESTIMATED_MODELS = 4;
const BILLION_TOKENS = 1_000_000_000;

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
    modelFitR2: null,
    modelEstimateWindows: 0,
    modelEstimates: [],
    weeks: ordered,
  };
}

export function calculateModelUsageEfficiency(
  weeks: UsageEfficiencyWeek[],
  rollups: ModelUsageRollup[],
): Pick<UsageEfficiencySummary, "modelFitR2" | "modelEstimateWindows" | "modelEstimates"> {
  const recentWeeks = [...weeks]
    .filter((week) => week.tokensPerPercent != null)
    .sort((a, b) => b.resetAt - a.resetAt)
    .slice(0, MODEL_ESTIMATE_WINDOW_COUNT);
  if (recentWeeks.length < MIN_MODEL_WINDOWS) {
    return { modelFitR2: null, modelEstimateWindows: recentWeeks.length, modelEstimates: [] };
  }

  const windowTokens = recentWeeks.map((week) => {
    const byModel = new Map<string, number>();
    for (const rollup of rollups) {
      if (rollup.bucketStart + ROLLUP_BUCKET_MS <= week.observedFrom || rollup.bucketStart > week.observedTo) continue;
      byModel.set(rollup.model, (byModel.get(rollup.model) ?? 0) + rollup.totalTokens);
    }
    return byModel;
  });
  const totals = new Map<string, number>();
  for (const byModel of windowTokens) {
    for (const [model, tokens] of byModel) totals.set(model, (totals.get(model) ?? 0) + tokens);
  }
  const allTokens = [...totals.values()].reduce((sum, tokens) => sum + tokens, 0);
  if (allTokens <= 0) {
    return { modelFitR2: null, modelEstimateWindows: recentWeeks.length, modelEstimates: [] };
  }

  const rankedModels = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const estimatedModels = rankedModels
    .filter(([model, tokens]) =>
      model !== "unknown" &&
      tokens / allTokens >= MIN_MODEL_TOKEN_SHARE &&
      countModelWindows(model, windowTokens) >= MIN_MODEL_WINDOWS
    )
    .slice(0, MAX_ESTIMATED_MODELS)
    .map(([model]) => model);

  const design = recentWeeks.map((_week, index) =>
    estimatedModels.map((model) => (windowTokens[index].get(model) ?? 0) / BILLION_TOKENS)
  );
  const outcome = recentWeeks.map((week) => week.observedUsagePercent);
  const coefficients = fitNonNegativeModel(design, outcome);
  const predictions = design.map((row) => row.reduce((sum, value, index) => sum + value * coefficients[index], 0));
  const fitR2 = calculateR2(outcome, predictions);
  const coefficientByModel = new Map(estimatedModels.map((model, index) => [model, coefficients[index]]));

  const modelEstimates: UsageEfficiencyModelEstimate[] = rankedModels.map(([model, observedTokens]) => {
    const recentTokenShare = observedTokens / allTokens;
    const windows = countModelWindows(model, windowTokens);
    const coefficient = coefficientByModel.get(model) ?? 0;
    const canEstimate = coefficient > 0 && fitR2 >= 0.35;
    const tokensPerPercent = canEstimate ? BILLION_TOKENS / coefficient : null;
    return {
      model,
      recentTokenShare,
      observedTokens,
      windows,
      tokensPerPercent,
      projectedWeeklyTokens: tokensPerPercent == null ? null : tokensPerPercent * 100,
      confidence: modelConfidence(recentTokenShare, windows, fitR2, canEstimate),
    };
  });
  return {
    modelFitR2: Number.isFinite(fitR2) ? fitR2 : null,
    modelEstimateWindows: recentWeeks.length,
    modelEstimates,
  };
}

function countModelWindows(model: string, windows: Array<Map<string, number>>): number {
  return windows.filter((byModel) => {
    const total = [...byModel.values()].reduce((sum, tokens) => sum + tokens, 0);
    return total > 0 && (byModel.get(model) ?? 0) / total >= 0.01;
  }).length;
}

function fitNonNegativeModel(design: number[][], outcome: number[]): number[] {
  if (design.length === 0 || design[0]?.length === 0) return [];
  const coefficients = new Array<number>(design[0].length).fill(0);
  for (let iteration = 0; iteration < 500; iteration += 1) {
    let largestChange = 0;
    for (let modelIndex = 0; modelIndex < coefficients.length; modelIndex += 1) {
      let numerator = 0;
      let denominator = 0;
      for (let windowIndex = 0; windowIndex < design.length; windowIndex += 1) {
        const value = design[windowIndex][modelIndex];
        const predictionWithoutModel = design[windowIndex].reduce(
          (sum, item, index) => sum + (index === modelIndex ? 0 : item * coefficients[index]),
          0,
        );
        numerator += value * (outcome[windowIndex] - predictionWithoutModel);
        denominator += value * value;
      }
      const next = denominator > 0 ? Math.max(0, numerator / denominator) : 0;
      largestChange = Math.max(largestChange, Math.abs(next - coefficients[modelIndex]));
      coefficients[modelIndex] = next;
    }
    if (largestChange < 1e-8) break;
  }
  return coefficients;
}

function calculateR2(actual: number[], predicted: number[]): number {
  if (actual.length === 0) return Number.NaN;
  const mean = actual.reduce((sum, value) => sum + value, 0) / actual.length;
  const totalVariation = actual.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  if (totalVariation <= 0) return Number.NaN;
  const residual = actual.reduce((sum, value, index) => sum + (value - predicted[index]) ** 2, 0);
  return 1 - residual / totalVariation;
}

function modelConfidence(
  recentTokenShare: number,
  windows: number,
  fitR2: number,
  canEstimate: boolean,
): "low" | "medium" | "high" {
  if (!canEstimate) return "low";
  if (recentTokenShare >= 0.15 && windows >= 6 && fitR2 >= 0.7) return "high";
  if (recentTokenShare >= 0.05 && windows >= 4 && fitR2 >= 0.45) return "medium";
  return "low";
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
