import type { UsageSnapshot } from "../../../shared/types";

export const REQUIRED_LIMIT_DROP_CONFIRMATIONS = 3;

const MATERIAL_DROP_PERCENTAGE_POINTS = 5;
const RECOVERY_TOLERANCE_PERCENTAGE_POINTS = 2;
const TRANSIENT_RECOVERY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Returns true when a limit appears to have reset or fallen by enough to
 * materially affect the displayed usage. Small changes are left alone because
 * the source rounds percentages to whole numbers.
 */
export function hasMaterialLimitDrop(previous: UsageSnapshot, next: UsageSnapshot): boolean {
  const droppedFields = getDroppedLimitFields(previous, next);
  if (droppedFields.length === 0) {
    return false;
  }

  let totalDrop = 0;
  let totalIncrease = 0;
  for (const field of ["primaryUsedPercent", "secondaryUsedPercent"] as const) {
    const before = previous[field];
    const after = next[field];
    if (before == null || after == null) {
      continue;
    }
    const change = after - before;
    if (change < 0) {
      totalDrop -= change;
    } else {
      totalIncrease += change;
    }
  }

  const includesNearZeroDrop = droppedFields.some((field) => {
    const before = previous[field] ?? 0;
    const after = next[field] ?? 0;
    return before >= 3 && after <= 1;
  });
  const isLargeEnough = totalDrop >= MATERIAL_DROP_PERCENTAGE_POINTS ||
    (includesNearZeroDrop && totalDrop >= 3);

  // A normal rise in the other limit is evidence against a whole-account reset.
  return isLargeEnough && totalDrop > totalIncrease + RECOVERY_TOLERANCE_PERCENTAGE_POINTS;
}

/**
 * Filters legacy, one- or two-sample drops which immediately recover. The raw
 * rows remain in SQLite for diagnosis; this only protects charts and rates.
 */
export function filterTransientLimitDrops(snapshots: UsageSnapshot[]): UsageSnapshot[] {
  const filtered: UsageSnapshot[] = [];

  for (let index = 0; index < snapshots.length; ) {
    const current = snapshots[index];
    const baseline = filtered[filtered.length - 1];

    if (!baseline || !hasMaterialLimitDrop(baseline, current)) {
      filtered.push(current);
      index += 1;
      continue;
    }

    let candidateEnd = index;
    while (
      candidateEnd < snapshots.length &&
      hasMaterialLimitDrop(baseline, snapshots[candidateEnd])
    ) {
      candidateEnd += 1;
    }

    const candidateCount = candidateEnd - index;
    const recovery = snapshots[candidateEnd];
    const lastCandidate = snapshots[candidateEnd - 1];
    const isTransient =
      candidateCount < REQUIRED_LIMIT_DROP_CONFIRMATIONS &&
      recovery != null &&
      recovery.checkedAt - lastCandidate.checkedAt <= TRANSIENT_RECOVERY_WINDOW_MS &&
      hasRecoveredDroppedLimits(baseline, lastCandidate, recovery);

    if (isTransient) {
      index = candidateEnd;
      continue;
    }

    filtered.push(current);
    index += 1;
  }

  return filtered;
}

function getDroppedLimitFields(
  previous: UsageSnapshot,
  next: UsageSnapshot,
): Array<"primaryUsedPercent" | "secondaryUsedPercent"> {
  const fields: Array<"primaryUsedPercent" | "secondaryUsedPercent"> = [];
  for (const field of ["primaryUsedPercent", "secondaryUsedPercent"] as const) {
    const before = previous[field];
    const after = next[field];
    if (
      before != null &&
      after != null &&
      (before - after >= MATERIAL_DROP_PERCENTAGE_POINTS || (before >= 3 && after <= 1))
    ) {
      fields.push(field);
    }
  }
  return fields;
}

function hasRecoveredDroppedLimits(
  baseline: UsageSnapshot,
  dropped: UsageSnapshot,
  recovery: UsageSnapshot,
): boolean {
  const droppedFields = getDroppedLimitFields(baseline, dropped);
  return droppedFields.every((field) => {
    const original = baseline[field];
    const recovered = recovery[field];
    return (
      original != null &&
      recovered != null &&
      recovered >= original - RECOVERY_TOLERANCE_PERCENTAGE_POINTS
    );
  });
}
