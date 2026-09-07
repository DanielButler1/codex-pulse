import assert from "node:assert/strict";
import test from "node:test";
import { findNextAvailableManualResetAt, getProjectionUsageSchedule } from "./projection-reset.ts";
import { calculateUsageOpportunity, findScheduledLimitHit } from "./usage-schedule.ts";
import type { CodexResetCreditsResult } from "./types.ts";

const NOW = 1_800_000_000_000;

function resetCredits(
  credits: CodexResetCreditsResult["credits"],
): CodexResetCreditsResult {
  return {
    checkedAt: NOW,
    credits,
    availableCount: credits.length,
    totalEarnedCount: credits.length,
    error: null,
  };
}

function credit(
  id: string,
  expiresAt: number | null,
  status = "available",
): CodexResetCreditsResult["credits"][number] {
  return {
    id,
    resetType: null,
    status,
    grantedAt: NOW - 1_000,
    expiresAt,
    title: null,
    description: null,
  };
}

test("returns the earliest future available manual reset", () => {
  const result = findNextAvailableManualResetAt(
    resetCredits([
      credit("later", NOW + 20_000),
      credit("next", NOW + 10_000),
    ]),
    NOW,
  );

  assert.equal(result, NOW + 10_000);
});

test("ignores expired, unavailable, and undated reset credits", () => {
  const result = findNextAvailableManualResetAt(
    resetCredits([
      credit("expired", NOW - 1),
      credit("used", NOW + 10_000, "used"),
      credit("undated", null),
    ]),
    NOW,
  );

  assert.equal(result, null);
});

test("returns null when reset credits have not loaded", () => {
  assert.equal(findNextAvailableManualResetAt(null, NOW), null);
});

test("custom reset ignores downtime for projection and pace without changing saved schedules", () => {
  const start = new Date(2026, 8, 8, 0).getTime();
  const end = new Date(2026, 8, 8, 6).getTime();
  const usageSchedule = [{ id: "sleep", name: "Sleep", days: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "07:00", usagePercent: 0 }];
  const customSchedule = getProjectionUsageSchedule({ projectionResetSource: "custom", projectionResetAt: end, usageSchedule }, start);
  assert.equal(calculateUsageOpportunity(start, end, customSchedule), end - start);
  const hit = findScheduledLimitHit(start, end, 2, 1, customSchedule);
  assert.ok(hit != null && Math.abs(hit - (start + 2 * 60 * 60 * 1000)) <= 60_000);

  for (const source of ["default", "manual"] as const) {
    const schedule = getProjectionUsageSchedule({ projectionResetSource: source, projectionResetAt: end, usageSchedule }, start);
    assert.equal(schedule, usageSchedule);
    assert.equal(calculateUsageOpportunity(start, end, schedule), 0);
    assert.equal(findScheduledLimitHit(start, end, 2, 1, schedule), null);
  }
  for (const resetAt of [null, start - 1, start]) {
    assert.equal(getProjectionUsageSchedule({ projectionResetSource: "custom", projectionResetAt: resetAt, usageSchedule }, start), usageSchedule);
  }
  assert.equal(usageSchedule[0].usagePercent, 0);
});
