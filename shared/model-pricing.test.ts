import assert from "node:assert/strict";
import test from "node:test";
import { estimateModelCostUsd, resolveModelPricing } from "./model-pricing.ts";

test("resolves Astra and dated Astra model IDs", () => {
  const expected = { inputUsdPer1M: 10, cachedInputUsdPer1M: 1, outputUsdPer1M: 50 };

  assert.deepEqual(resolveModelPricing("gpt-6-astra"), expected);
  assert.deepEqual(resolveModelPricing("GPT-6-ASTRA-2026-09-03"), expected);
});

test("estimates Astra cost with cached input as a subset of input", () => {
  assert.equal(
    estimateModelCostUsd("gpt-6-astra", {
      inputTokens: 2_000_000,
      cachedInputTokens: 500_000,
      outputTokens: 1_000_000,
    }),
    65.5,
  );
});

test("uses current GPT-5.6 API pricing", () => {
  assert.deepEqual(resolveModelPricing("gpt-5.6"), {
    inputUsdPer1M: 4,
    cachedInputUsdPer1M: 0.4,
    outputUsdPer1M: 20,
  });
  assert.deepEqual(resolveModelPricing("gpt-5.6-terra"), {
    inputUsdPer1M: 2,
    cachedInputUsdPer1M: 0.2,
    outputUsdPer1M: 12,
  });
  assert.deepEqual(resolveModelPricing("gpt-5.6-luna"), {
    inputUsdPer1M: 0.2,
    cachedInputUsdPer1M: 0.02,
    outputUsdPer1M: 1.2,
  });
});

test("uses the balanced current model rate for unknown future model IDs", () => {
  assert.deepEqual(resolveModelPricing("unknown"), {
    inputUsdPer1M: 2,
    cachedInputUsdPer1M: 0.2,
    outputUsdPer1M: 12,
  });
  // A newer GPT-5 point release is unknown, not GPT-5.
  assert.deepEqual(resolveModelPricing("gpt-5.7-sol"), resolveModelPricing("unknown"));
});

test("prices older Codex models at their API rates", () => {
  const gpt51 = { inputUsdPer1M: 1.25, cachedInputUsdPer1M: 0.125, outputUsdPer1M: 10 };

  assert.deepEqual(resolveModelPricing("gpt-5.1-codex-max"), gpt51);
  assert.deepEqual(resolveModelPricing("gpt-5.1-codex"), gpt51);
  assert.deepEqual(resolveModelPricing("gpt-5-codex"), gpt51);
  assert.deepEqual(resolveModelPricing("gpt-5"), gpt51);
  assert.deepEqual(resolveModelPricing("gpt-5.1-codex-mini"), {
    inputUsdPer1M: 0.25,
    cachedInputUsdPer1M: 0.025,
    outputUsdPer1M: 2,
  });
  assert.deepEqual(resolveModelPricing("gpt-5.2-codex"), {
    inputUsdPer1M: 1.75,
    cachedInputUsdPer1M: 0.175,
    outputUsdPer1M: 14,
  });
});

test("prices Codex's auto-review alias at GPT-5.6 Luna rates", () => {
  assert.deepEqual(resolveModelPricing("codex-auto-review"), resolveModelPricing("gpt-5.6-luna"));
});

test("prices GPT-6.1 Sol rollout tokens with its own rates", () => {
  const cost = estimateModelCostUsd("gpt-6.1-sol", {
    inputTokens: 10_000_000,
    cachedInputTokens: 9_000_000,
    outputTokens: 100_000,
  });
  // 1M uncached at $2, 9M cached at $0.10, 0.1M output at $10
  assert.equal(Number(cost.toFixed(6)), 3.9);
});
