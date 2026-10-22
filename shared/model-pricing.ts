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

// OpenAI API standard-processing prices in USD per million tokens, updated 2026-10-22.
// https://developers.openai.com/api/docs/pricing (short-context rates) and the GPT-5.x Codex model pages.
// Prefixes are matched in order, so longer model IDs must come before their shorter prefixes.
const MODEL_PRICING: Array<{ prefix: string; pricing: ModelPricing }> = [
  {
    prefix: "gpt-6-astra",
    pricing: { inputUsdPer1M: 10, cachedInputUsdPer1M: 1, outputUsdPer1M: 50 },
  },
  {
    prefix: "gpt-6.1-sol",
    pricing: { inputUsdPer1M: 2, cachedInputUsdPer1M: 0.1, outputUsdPer1M: 10 },
  },
  {
    prefix: "gpt-6-sol",
    pricing: { inputUsdPer1M: 2, cachedInputUsdPer1M: 0.2, outputUsdPer1M: 10 },
  },
  {
    prefix: "gpt-6-luna",
    pricing: { inputUsdPer1M: 0.1, cachedInputUsdPer1M: 0.01, outputUsdPer1M: 0.5 },
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
    prefix: "gpt-5.4-nano",
    pricing: { inputUsdPer1M: 0.2, cachedInputUsdPer1M: 0.02, outputUsdPer1M: 1.25 },
  },
  {
    prefix: "gpt-5.4",
    pricing: { inputUsdPer1M: 2.5, cachedInputUsdPer1M: 0.25, outputUsdPer1M: 15 },
  },
  {
    // A research preview with no published API price.
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
  {
    prefix: "gpt-5.1-codex-mini",
    pricing: { inputUsdPer1M: 0.25, cachedInputUsdPer1M: 0.025, outputUsdPer1M: 2 },
  },
  {
    // GPT-5.1, GPT-5.1 Codex, and GPT-5.1 Codex Max.
    prefix: "gpt-5.1",
    pricing: { inputUsdPer1M: 1.25, cachedInputUsdPer1M: 0.125, outputUsdPer1M: 10 },
  },
  {
    prefix: "gpt-5-mini",
    pricing: { inputUsdPer1M: 0.25, cachedInputUsdPer1M: 0.025, outputUsdPer1M: 2 },
  },
  {
    prefix: "gpt-5-nano",
    pricing: { inputUsdPer1M: 0.05, cachedInputUsdPer1M: 0.005, outputUsdPer1M: 0.4 },
  },
  {
    // GPT-5 and GPT-5 Codex.
    prefix: "gpt-5",
    pricing: { inputUsdPer1M: 1.25, cachedInputUsdPer1M: 0.125, outputUsdPer1M: 10 },
  },
];

const FREE: ModelPricing = { inputUsdPer1M: 0, cachedInputUsdPer1M: 0, outputUsdPer1M: 0 };

// Codex auto-review (model "codex-auto-review") is a server-routed alias with no API price of its own.
// It has been free with ChatGPT sign-in since 2026-10-06; before that it's priced as the model running
// it: GPT-5.4, then GPT-5.6 Luna from 2026-07-30 (OpenAI's documented migration), then the newest Luna,
// GPT-6 Luna, from its release on 2026-09-22. Newest first.
const AUTO_REVIEW_MODELS: Array<{ fromMs: number; model: string | null }> = [
  { fromMs: Date.UTC(2026, 9, 6), model: null },
  { fromMs: Date.UTC(2026, 8, 22), model: "gpt-6-luna" },
  { fromMs: Date.UTC(2026, 6, 30), model: "gpt-5.6-luna" },
  { fromMs: -Infinity, model: "gpt-5.4" },
];

// atMs: when the tokens were used. Only Codex auto-review's price depends on it.
export function resolveModelPricing(model: string, atMs: number = Date.now()): ModelPricing {
  const normalized = model.toLowerCase();
  if (normalized === "codex-auto-review") {
    const runner = AUTO_REVIEW_MODELS.find(({ fromMs }) => atMs >= fromMs)?.model ?? null;
    return runner ? resolveModelPricing(runner) : FREE;
  }
  // Match whole name segments, so "gpt-5" covers "gpt-5-codex" but not a newer "gpt-5.7".
  return (
    MODEL_PRICING.find(
      ({ prefix }) => normalized === prefix || normalized.startsWith(`${prefix}-`),
    )?.pricing ?? FALLBACK_MODEL_PRICING
  );
}

export function estimateModelCostUsd(
  model: string,
  usage: TokenUsage,
  atMs: number = Date.now(),
): number {
  const pricing = resolveModelPricing(model, atMs);
  // Cached input tokens are a discounted subset of input tokens, not an extra bucket.
  const cachedInputTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const uncachedInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);
  const estimated =
    (uncachedInputTokens / 1_000_000) * pricing.inputUsdPer1M +
    (cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPer1M +
    (usage.outputTokens / 1_000_000) * pricing.outputUsdPer1M;

  return Number.isFinite(estimated) && estimated > 0 ? estimated : 0;
}
