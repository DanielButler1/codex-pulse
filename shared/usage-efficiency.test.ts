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
    snapshot(resetAt - 5_000, resetAt, 7),
  ];
  const result = calculateUsageEfficiency(snapshots, [{
    bucketStart: resetAt - 8_000, model: "test", requests: 1, inputTokens: 400,
    cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0,
    totalTokens: 400, estimatedCostUsd: 0,
  }], resetAt - 1_000);
  assert.equal(result.observedUsagePercent, 2);
  assert.equal(result.tokensPerPercent, 200);
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
});

function snapshot(checkedAt: number, resetAt: number, used: number): UsageSnapshot {
  return {
    checkedAt, provider: "codex", primaryUsedPercent: null, primaryResetAfterSeconds: null,
    secondaryUsedPercent: used, secondaryResetAfterSeconds: (resetAt - checkedAt) / 1000,
  };
}
