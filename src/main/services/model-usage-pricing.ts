export type PricedTokenTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

type ModelPricing = {
  inputUsdPer1M: number;
  cachedInputUsdPer1M: number;
  outputUsdPer1M: number;
};

const FALLBACK: ModelPricing = { inputUsdPer1M: 2.5, cachedInputUsdPer1M: 0.25, outputUsdPer1M: 15 };
const PRICING: Array<{ prefix: string; pricing: ModelPricing }> = [
  { prefix: "gpt-5.6-luna", pricing: { inputUsdPer1M: 1, cachedInputUsdPer1M: 0.1, outputUsdPer1M: 6 } },
  { prefix: "gpt-5.6-terra", pricing: { inputUsdPer1M: 2.5, cachedInputUsdPer1M: 0.25, outputUsdPer1M: 15 } },
  { prefix: "gpt-5.6-sol", pricing: { inputUsdPer1M: 5, cachedInputUsdPer1M: 0.5, outputUsdPer1M: 30 } },
  { prefix: "gpt-5.6", pricing: { inputUsdPer1M: 5, cachedInputUsdPer1M: 0.5, outputUsdPer1M: 30 } },
  { prefix: "gpt-5.5", pricing: { inputUsdPer1M: 5, cachedInputUsdPer1M: 0.5, outputUsdPer1M: 30 } },
  { prefix: "gpt-5.4-mini", pricing: { inputUsdPer1M: 0.75, cachedInputUsdPer1M: 0.075, outputUsdPer1M: 4.5 } },
  { prefix: "gpt-5.4", pricing: { inputUsdPer1M: 2.5, cachedInputUsdPer1M: 0.25, outputUsdPer1M: 15 } },
  { prefix: "gpt-5.3-codex-spark", pricing: { inputUsdPer1M: 0.75, cachedInputUsdPer1M: 0.075, outputUsdPer1M: 4.5 } },
  { prefix: "gpt-5.3-codex", pricing: { inputUsdPer1M: 1.75, cachedInputUsdPer1M: 0.175, outputUsdPer1M: 14 } },
  { prefix: "gpt-5.2-codex", pricing: { inputUsdPer1M: 1.75, cachedInputUsdPer1M: 0.175, outputUsdPer1M: 14 } },
  { prefix: "gpt-5.2", pricing: { inputUsdPer1M: 1.75, cachedInputUsdPer1M: 0.175, outputUsdPer1M: 14 } },
];

export function estimateIndexedCostUsd(model: string, usage: PricedTokenTotals): number {
  const normalized = model.toLowerCase();
  const pricing = PRICING.find((candidate) => normalized.startsWith(candidate.prefix))?.pricing ?? FALLBACK;
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const uncached = Math.max(0, usage.inputTokens - cached);
  return (uncached / 1_000_000) * pricing.inputUsdPer1M +
    (cached / 1_000_000) * pricing.cachedInputUsdPer1M +
    (usage.outputTokens / 1_000_000) * pricing.outputUsdPer1M;
}
