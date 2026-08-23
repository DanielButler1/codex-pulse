import assert from "node:assert/strict";
import test from "node:test";
import { calculateUsageEfficiency, summarizeUsageEfficiency } from "../src/main/services/usage-efficiency.ts";
import type { ModelUsageRollup } from "../src/main/db.ts";
import type { UsageSnapshot } from "./types.ts";

test("calculates weighted tokens per weekly usage percentage", () => {
  const resetAt = Date.parse("2026-08-24T00:00:00Z");
  const snapshots = [snapshot(resetAt - 10_000, resetAt, 10), snapshot(resetAt - 5_000, resetAt, 15)];
  const rollups: ModelUsageRollup[] = [{
    bucketStart: resetAt - 8_000, model: "test", requests: 1, inputTokens: 800,
    cachedInputTokens: 0, outputTokens: 200, reasoningOutputTokens: 0,
    totalTokens: 1_000, estimatedCostUsd: 0,
  }];
  const result = calculateUsageEfficiency(snapshots, rollups, resetAt - 1_000);
  assert.equal(result.tokensPerPercent, 200);
  assert.equal(result.projectedWeeklyTokens, 20_000);
  assert.equal(result.weeks[0].observedUsagePercent, 5);
});

test("ignores usage drops when estimating efficiency", () => {
  const resetAt = Date.parse("2026-08-24T00:00:00Z");
  const snapshots = [
    snapshot(resetAt - 15_000, resetAt, 20),
    snapshot(resetAt - 10_000, resetAt, 5),
    snapshot(resetAt - 5_000, resetAt, 12),
  ];
  const result = calculateUsageEfficiency(snapshots, [{
    bucketStart: resetAt - 8_000, model: "test", requests: 1, inputTokens: 1_400,
    cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0,
    totalTokens: 1_400, estimatedCostUsd: 0,
  }], resetAt - 1_000);
  assert.equal(result.observedUsagePercent, 7);
  assert.equal(result.tokensPerPercent, 200);
});

test("uses forward range instead of repeated positive movements", () => {
  const resetAt = Date.parse("2026-08-24T00:00:00Z");
  const snapshots = [
    snapshot(resetAt - 20_000, resetAt, 10),
    snapshot(resetAt - 15_000, resetAt, 20),
    snapshot(resetAt - 10_000, resetAt, 12),
    snapshot(resetAt - 5_000, resetAt, 21),
  ];
  const result = calculateUsageEfficiency(snapshots, [{
    bucketStart: resetAt - 18_000, model: "test", requests: 1, inputTokens: 1_100,
    cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0,
    totalTokens: 1_100, estimatedCostUsd: 0,
  }]);
  assert.equal(result.weeks[0].observedUsagePercent, 11);
  assert.equal(result.weeks[0].projectedWeeklyTokens, 10_000);
});

test("selects non-overlapping reset windows with stronger evidence", () => {
  const base = Date.parse("2026-08-10T00:00:00Z");
  const firstReset = Date.parse("2026-08-17T00:00:00Z");
  const secondReset = Date.parse("2026-08-24T00:00:00Z");
  const staleReset = Date.parse("2026-08-20T00:00:00Z");
  const snapshots = [
    snapshot(base, firstReset, 10), snapshot(base + 40_000, firstReset, 30),
    snapshot(base + 10_000, staleReset, 10), snapshot(base + 30_000, staleReset, 15),
    snapshot(base + 50_000, secondReset, 5), snapshot(base + 70_000, secondReset, 25),
  ];
  const result = calculateUsageEfficiency(snapshots, [rollup(base + 20_000, 2_000), rollup(base + 60_000, 3_000)]);
  assert.deepEqual(result.weeks.map((week) => week.resetAt), [secondReset, firstReset]);
});

test("summarizes persisted weekly estimates in reverse chronological order", () => {
  const result = summarizeUsageEfficiency([
    {
      resetAt: 1,
      observedFrom: 0,
      observedTo: 1,
      observedUsagePercent: 10,
      totalTokens: 1_000,
      tokensPerPercent: 100,
      projectedWeeklyTokens: 10_000,
      observations: 2,
    },
    {
      resetAt: 2,
      observedFrom: 1,
      observedTo: 2,
      observedUsagePercent: 20,
      totalTokens: 4_000,
      tokensPerPercent: 200,
      projectedWeeklyTokens: 20_000,
      observations: 3,
    },
  ], 3);

  assert.deepEqual(result.weeks.map((week) => week.resetAt), [2, 1]);
  assert.equal(result.tokensPerPercent, 5_000 / 30);
  assert.equal(result.projectedWeeklyTokens, (5_000 / 30) * 100);
  assert.equal(result.generatedAt, 3);
  assert.equal(result.estimateWeeks, 2);
});

function snapshot(checkedAt: number, resetAt: number, used: number): UsageSnapshot {
  return {
    checkedAt, provider: "codex", primaryUsedPercent: null, primaryResetAfterSeconds: null,
    secondaryUsedPercent: used, secondaryResetAfterSeconds: (resetAt - checkedAt) / 1000,
    secondaryWindowMinutes: 7 * 24 * 60,
  };
}

function rollup(bucketStart: number, totalTokens: number): ModelUsageRollup {
  return {
    bucketStart, model: "test", requests: 1, inputTokens: totalTokens,
    cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0,
    totalTokens, estimatedCostUsd: 0,
  };
}
