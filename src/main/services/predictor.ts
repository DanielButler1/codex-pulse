import type { UsageSnapshot } from "../../../shared/types";

type BurnRateWindow = "15m" | "60m" | "window";

export type BurnRateResult = {
  "15m": number | null;
  "60m": number | null;
  window: number | null;
  defaultRate: number | null;
};

const MINUTE = 60_000;
const DEFAULT_WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
const MAX_REASONABLE_RATE_PER_HOUR = 20;

export function calculateBurnRate(snapshots: UsageSnapshot[]): number | null {
  const usable = sanitizeSnapshots(snapshots);

  if (usable.length < 2) {
    return null;
  }

  const first = usable[0];
  const latest = usable[usable.length - 1];
  const deltaPercent = latest.secondaryUsedPercent! - first.secondaryUsedPercent!;
  const deltaHours = (latest.checkedAt - first.checkedAt) / (60 * MINUTE);

  if (deltaPercent <= 0 || deltaHours <= 0) {
    return null;
  }

  return deltaPercent / deltaHours;
}

export function calculateBurnRates(snapshots: UsageSnapshot[]): BurnRateResult {
  const usable = sanitizeSnapshots(snapshots);
  const latest = usable[usable.length - 1];
  const baselineWindowRate = latest ? calculateBaselineWindowRate(latest) : null;
  const inWindow = latest ? getSnapshotsInCurrentWindow(usable, latest) : [];

  const rate15m = latest
    ? calculateRobustRate(filterRecentSnapshots(inWindow, latest.checkedAt, 15 * MINUTE), baselineWindowRate)
    : null;
  const rate60m = latest
    ? calculateRobustRate(filterRecentSnapshots(inWindow, latest.checkedAt, 60 * MINUTE), baselineWindowRate)
    : null;
  const windowRate = latest ? calculateWindowRate(inWindow, latest) ?? baselineWindowRate : baselineWindowRate;

  const byWindow: Record<BurnRateWindow, number | null> = {
    "15m": rate15m,
    "60m": rate60m,
    window: windowRate,
  };

  const defaultRate = calculateAdaptiveDefaultRate({
    baseline: baselineWindowRate,
    windowRate,
    rate60m,
    rate15m,
  });

  return {
    "15m": byWindow["15m"],
    "60m": byWindow["60m"],
    window: byWindow.window,
    defaultRate,
  };
}

export function estimateLimitHit(
  latest: UsageSnapshot | null,
  percentPerHour: number | null,
): number | null {
  if (!latest || !percentPerHour || latest.secondaryUsedPercent == null) {
    return null;
  }
  const remaining = 100 - latest.secondaryUsedPercent;
  if (remaining <= 0 || percentPerHour <= 0) {
    return latest.checkedAt;
  }

  const hoursRemaining = remaining / percentPerHour;
  return latest.checkedAt + hoursRemaining * 60 * MINUTE;
}

function filterRecentSnapshots(
  snapshots: UsageSnapshot[],
  referenceTimeMs: number,
  durationMs: number,
): UsageSnapshot[] {
  const cutoff = referenceTimeMs - durationMs;
  return snapshots.filter((snapshot) => snapshot.checkedAt >= cutoff && snapshot.checkedAt <= referenceTimeMs);
}

function calculateWindowRate(
  snapshots: UsageSnapshot[],
  latest: UsageSnapshot,
): number | null {
  if (
    latest.secondaryResetAfterSeconds == null ||
    latest.secondaryResetAfterSeconds < 0
  ) {
    return null;
  }

  const windowMinutes = latest.secondaryWindowMinutes ?? DEFAULT_WEEKLY_WINDOW_MINUTES;
  if (windowMinutes <= 0) {
    return null;
  }

  const windowMs = windowMinutes * MINUTE;
  const remainingMs = latest.secondaryResetAfterSeconds * 1000;
  const elapsedMs = Math.max(0, windowMs - remainingMs);
  if (elapsedMs <= 0) {
    return null;
  }

  const windowStart = latest.checkedAt - elapsedMs;
  const inWindow = snapshots.filter((snapshot) => snapshot.checkedAt >= windowStart && snapshot.checkedAt <= latest.checkedAt);
  return calculateRobustRate(inWindow, calculateBaselineWindowRate(latest));
}

function calculateBaselineWindowRate(latest: UsageSnapshot): number | null {
  if (
    latest.secondaryUsedPercent == null ||
    latest.secondaryResetAfterSeconds == null ||
    latest.secondaryResetAfterSeconds < 0
  ) {
    return null;
  }

  const windowMinutes = latest.secondaryWindowMinutes ?? DEFAULT_WEEKLY_WINDOW_MINUTES;
  if (windowMinutes <= 0) {
    return null;
  }

  const windowMs = windowMinutes * MINUTE;
  const remainingMs = latest.secondaryResetAfterSeconds * 1000;
  const elapsedMs = Math.max(0, windowMs - remainingMs);
  if (elapsedMs <= 0) {
    return null;
  }

  const elapsedHours = elapsedMs / (60 * MINUTE);
  const usedPercent = Math.max(0, latest.secondaryUsedPercent);
  if (usedPercent <= 0) {
    return 0;
  }
  return usedPercent / elapsedHours;
}

function getSnapshotsInCurrentWindow(
  snapshots: UsageSnapshot[],
  latest: UsageSnapshot,
): UsageSnapshot[] {
  if (latest.secondaryResetAfterSeconds == null || latest.secondaryResetAfterSeconds < 0) {
    return snapshots;
  }
  const windowMinutes = latest.secondaryWindowMinutes ?? DEFAULT_WEEKLY_WINDOW_MINUTES;
  if (windowMinutes <= 0) {
    return snapshots;
  }

  const windowMs = windowMinutes * MINUTE;
  const remainingMs = latest.secondaryResetAfterSeconds * 1000;
  const elapsedMs = Math.max(0, windowMs - remainingMs);
  const windowStart = latest.checkedAt - elapsedMs;
  return snapshots.filter((snapshot) => snapshot.checkedAt >= windowStart && snapshot.checkedAt <= latest.checkedAt);
}

function calculateRobustRate(
  snapshots: UsageSnapshot[],
  baselineRate: number | null,
): number | null {
  if (snapshots.length < 2) {
    return null;
  }

  const segments: Array<{ rate: number; weight: number }> = [];
  const capFromBaseline =
    baselineRate != null && baselineRate > 0
      ? Math.max(1.2, baselineRate * 3.5, baselineRate + 0.8)
      : 6;
  const segmentCap = Math.min(MAX_REASONABLE_RATE_PER_HOUR, capFromBaseline);

  for (let i = 1; i < snapshots.length; i += 1) {
    const previous = snapshots[i - 1];
    const current = snapshots[i];
    const deltaMs = current.checkedAt - previous.checkedAt;
    if (deltaMs < 30_000) {
      continue;
    }
    const deltaHours = deltaMs / (60 * MINUTE);
    if (deltaHours <= 0) {
      continue;
    }
    const previousUsed = previous.secondaryUsedPercent ?? 0;
    const currentUsed = current.secondaryUsedPercent ?? 0;
    const deltaPercent = currentUsed - previousUsed;
    const rawRate = deltaPercent / deltaHours;
    const rate = clamp(rawRate, 0, segmentCap);
    segments.push({
      rate,
      weight: deltaHours,
    });
  }

  if (segments.length === 0) {
    return null;
  }

  return weightedMedianRate(segments);
}

function calculateAdaptiveDefaultRate(input: {
  baseline: number | null;
  windowRate: number | null;
  rate60m: number | null;
  rate15m: number | null;
}): number | null {
  const blended = weightedAverage([
    { value: input.baseline, weight: 0.65 },
    { value: input.windowRate, weight: 0.2 },
    { value: input.rate60m, weight: 0.1 },
    { value: input.rate15m, weight: 0.05 },
  ]);

  if (blended == null) {
    return null;
  }

  let rate = blended;
  if (input.baseline != null && input.baseline > 0) {
    // Guard against transient spikes, but still allow genuine acceleration.
    const upperBound = Math.max(1.0, input.baseline * 2.2, input.baseline + 0.4);
    rate = Math.min(rate, upperBound);
  }

  return clamp(rate, 0, MAX_REASONABLE_RATE_PER_HOUR);
}

function sanitizeSnapshots(snapshots: UsageSnapshot[]): UsageSnapshot[] {
  const filtered = snapshots
    .filter(
      (snapshot) =>
        snapshot.secondaryUsedPercent != null &&
        Number.isFinite(snapshot.secondaryUsedPercent) &&
        Number.isFinite(snapshot.checkedAt),
    )
    .sort((a, b) => a.checkedAt - b.checkedAt);

  if (filtered.length <= 1) {
    return filtered;
  }

  const deduped: UsageSnapshot[] = [];
  for (const snapshot of filtered) {
    const last = deduped[deduped.length - 1];
    if (last && last.checkedAt === snapshot.checkedAt) {
      deduped[deduped.length - 1] = snapshot;
    } else {
      deduped.push(snapshot);
    }
  }
  return deduped;
}

function weightedMedianRate(values: Array<{ rate: number; weight: number }>): number {
  const sorted = [...values]
    .filter((value) => Number.isFinite(value.rate) && value.weight > 0)
    .sort((a, b) => a.rate - b.rate);
  if (sorted.length === 0) {
    return 0;
  }
  const total = sorted.reduce((sum, value) => sum + value.weight, 0);
  const midpoint = total / 2;
  let running = 0;
  for (const value of sorted) {
    running += value.weight;
    if (running >= midpoint) {
      return value.rate;
    }
  }
  return sorted[sorted.length - 1].rate;
}

function weightedAverage(
  values: Array<{ value: number | null; weight: number }>,
): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const entry of values) {
    if (entry.value == null || !Number.isFinite(entry.value) || entry.value < 0) {
      continue;
    }
    numerator += entry.value * entry.weight;
    denominator += entry.weight;
  }
  if (denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
