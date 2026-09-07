import type { UsageSchedulePeriod } from "./types";

const MINUTE_MS = 60_000;

type WeightedSegment = { start: number; end: number; multiplier: number };

export function calculateUsageOpportunity(
  start: number,
  end: number,
  periods: UsageSchedulePeriod[],
): number {
  if (end <= start) return 0;

  const segments = buildSegments(start, end, periods);
  if (segments.length === 0) return end - start;

  const boundaries = [...new Set([start, end, ...segments.flatMap((segment) => [segment.start, segment.end])])]
    .filter((value) => value >= start && value <= end)
    .sort((a, b) => a - b);

  let weightedMs = 0;
  for (let index = 1; index < boundaries.length; index += 1) {
    const segmentStart = boundaries[index - 1];
    const segmentEnd = boundaries[index];
    const multiplier = segments.reduce(
      (lowest, segment) =>
        segment.start < segmentEnd && segment.end > segmentStart
          ? Math.min(lowest, segment.multiplier)
          : lowest,
      1,
    );
    weightedMs += (segmentEnd - segmentStart) * multiplier;
  }
  return weightedMs;
}

export function calculateScheduledUsage(
  start: number,
  end: number,
  normalRatePercentPerHour: number,
  periods: UsageSchedulePeriod[],
): number {
  return (calculateUsageOpportunity(start, end, periods) / (60 * MINUTE_MS)) * normalRatePercentPerHour;
}

export function findScheduledLimitHit(
  start: number,
  end: number,
  remainingPercent: number,
  normalRatePercentPerHour: number,
  periods: UsageSchedulePeriod[],
): number | null {
  if (remainingPercent <= 0) return start;
  if (end <= start || normalRatePercentPerHour <= 0) return null;
  if (calculateScheduledUsage(start, end, normalRatePercentPerHour, periods) < remainingPercent) return null;

  let low = start;
  let high = end;
  while (high - low > MINUTE_MS) {
    const middle = low + (high - low) / 2;
    if (calculateScheduledUsage(start, middle, normalRatePercentPerHour, periods) >= remainingPercent) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
}

function buildSegments(start: number, end: number, periods: UsageSchedulePeriod[]): WeightedSegment[] {
  const segments: WeightedSegment[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - 1);
  const finalDay = new Date(end);
  finalDay.setHours(0, 0, 0, 0);

  while (cursor.getTime() <= finalDay.getTime()) {
    for (const period of periods) {
      if (!period.days.includes(cursor.getDay())) continue;
      const periodStart = atLocalTime(cursor, period.startTime);
      const periodEnd = atLocalTime(cursor, period.endTime);
      if (periodEnd <= periodStart) periodEnd.setDate(periodEnd.getDate() + 1);
      if (periodStart.getTime() < end && periodEnd.getTime() > start) {
        segments.push({
          start: Math.max(start, periodStart.getTime()),
          end: Math.min(end, periodEnd.getTime()),
          multiplier: Math.max(0, Math.min(100, period.usagePercent)) / 100,
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return segments;
}

function atLocalTime(day: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const result = new Date(day);
  result.setHours(hours || 0, minutes || 0, 0, 0);
  return result;
}
