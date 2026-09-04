export type ModelPricing = {
  inputUsdPer1M: number;
  cachedInputUsdPer1M: number;
  outputUsdPer1M: number;
};

type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

const FALLBACK_MODEL_PRICING: ModelPricing = {
  inputUsdPer1M: 2,
  cachedInputUsdPer1M: 0.2,
  outputUsdPer1M: 12,
};

// OpenAI API standard-processing prices in USD per million tokens, updated 2026-09-04.
// https://developers.openai.com/api/docs/models/compare
const MODEL_PRICING: Array<{ prefix: string; pricing: ModelPricing }> = [
  {
    prefix: "gpt-6-astra",
    pricing: { inputUsdPer1M: 10, cachedInputUsdPer1M: 1, outputUsdPer1M: 50 },
  },
  {
    prefix: "gpt-5.6-luna",
    pricing: { inputUsdPer1M: 0.2, cachedInputUsdPer1M: 0.02, outputUsdPer1M: 1.2 },
  },
  {
    prefix: "gpt-5.6-terra",
    pricing: { inputUsdPer1M: 2, cachedInputUsdPer1M: 0.2, outputUsdPer1M: 12 },
  },
  {
    prefix: "gpt-5.6-sol",
    pricing: { inputUsdPer1M: 4, cachedInputUsdPer1M: 0.4, outputUsdPer1M: 20 },
  },
  {
    // Treat the API alias as the flagship Sol tier.
    prefix: "gpt-5.6",
    pricing: { inputUsdPer1M: 4, cachedInputUsdPer1M: 0.4, outputUsdPer1M: 20 },
  },
  {
    prefix: "gpt-5.5",
    pricing: { inputUsdPer1M: 5, cachedInputUsdPer1M: 0.5, outputUsdPer1M: 30 },
  },
  {
    prefix: "gpt-5.4-mini",
    pricing: { inputUsdPer1M: 0.75, cachedInputUsdPer1M: 0.075, outputUsdPer1M: 4.5 },
  },
  {
    prefix: "gpt-5.4",
    pricing: { inputUsdPer1M: 2.5, cachedInputUsdPer1M: 0.25, outputUsdPer1M: 15 },
  },
  {
    prefix: "gpt-5.3-codex-spark",
    pricing: { inputUsdPer1M: 0.75, cachedInputUsdPer1M: 0.075, outputUsdPer1M: 4.5 },
  },
  {
    prefix: "gpt-5.3-codex",
    pricing: { inputUsdPer1M: 1.75, cachedInputUsdPer1M: 0.175, outputUsdPer1M: 14 },
  },
  {
    prefix: "gpt-5.2-codex",
    pricing: { inputUsdPer1M: 1.75, cachedInputUsdPer1M: 0.175, outputUsdPer1M: 14 },
  },
  {
    prefix: "gpt-5.2",
    pricing: { inputUsdPer1M: 1.75, cachedInputUsdPer1M: 0.175, outputUsdPer1M: 14 },
  },
];

export function resolveModelPricing(model: string): ModelPricing {
  const normalized = model.toLowerCase();
  return (
    MODEL_PRICING.find((candidate) => normalized.startsWith(candidate.prefix))?.pricing ??
    FALLBACK_MODEL_PRICING
  );
}

export function estimateModelCostUsd(model: string, usage: TokenUsage): number {
  const pricing = resolveModelPricing(model);
  // Cached input tokens are a discounted subset of input tokens, not an extra bucket.
  const cachedInputTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const uncachedInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);
  const estimated =
    (uncachedInputTokens / 1_000_000) * pricing.inputUsdPer1M +
    (cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPer1M +
    (usage.outputTokens / 1_000_000) * pricing.outputUsdPer1M;

  return Number.isFinite(estimated) && estimated > 0 ? estimated : 0;
}
