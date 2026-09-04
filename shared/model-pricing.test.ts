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
});
