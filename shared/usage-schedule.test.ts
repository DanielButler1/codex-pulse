import assert from "node:assert/strict";
import test from "node:test";
import { calculateUsageOpportunity, findScheduledLimitHit } from "./usage-schedule.ts";
import type { UsageSchedulePeriod } from "./types.ts";

function localDate(day: number, hour = 0): number {
  return new Date(2026, 8, day, hour).getTime();
}

const sleep: UsageSchedulePeriod = {
  id: "sleep",
  name: "Sleep",
  days: [0, 1, 2, 3, 4, 5, 6],
  startTime: "00:00",
  endTime: "07:00",
  usagePercent: 0,
};

test("removes daily no-usage time from opportunity", () => {
  assert.equal(calculateUsageOpportunity(localDate(1), localDate(2), [sleep]), 17 * 60 * 60 * 1000);
});

test("weights reduced usage and uses the most restrictive overlap", () => {
  const reduced = { ...sleep, id: "work", startTime: "06:00", endTime: "10:00", usagePercent: 25 };
  assert.equal(calculateUsageOpportunity(localDate(1), localDate(2), [sleep, reduced]), 14.75 * 60 * 60 * 1000);
});

test("supports periods crossing midnight", () => {
  const overnight = { ...sleep, days: [new Date(localDate(1)).getDay()], startTime: "22:00", endTime: "06:00" };
  assert.equal(calculateUsageOpportunity(localDate(1), localDate(2, 12), [overnight]), 28 * 60 * 60 * 1000);
});

test("finds a limit hit after scheduled downtime", () => {
  const hit = findScheduledLimitHit(localDate(1), localDate(2), 2, 1, [sleep]);
  assert.ok(hit != null);
  assert.ok(Math.abs(hit - localDate(1, 9)) <= 60_000);
});
