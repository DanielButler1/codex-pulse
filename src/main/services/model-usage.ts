import fs from "node:fs";
import path from "node:path";
import type {
  ModelUsageHeatmapData,
  ModelUsageRange,
  ModelUsageRow,
  ModelUsageSummary,
} from "../../../shared/types";
import { resolveCodexHome } from "./codex-auth";

type MutableModelUsageRow = ModelUsageRow;

type TokenTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

type TimelineGranularity = "5m" | "15m" | "1h" | "6h" | "1d" | "1mo";

type TimelineBucket = {
  bucketStart: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

type HeatmapBucket = {
  dayIndex: number;
  hour: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

type MonthProjection = {
  monthStart: number;
  monthEnd: number;
  elapsedRatio: number;
  tokensSoFar: number;
  estimatedCostSoFar: number;
  projectedTokens: number;
  projectedCostUsd: number;
};

type ModelPricing = {
  inputUsdPer1M: number;
  cachedInputUsdPer1M: number;
  outputUsdPer1M: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const YIELD_EVERY_LINES = 2_000;
const RANGE_TO_MS = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
} as const;

const FALLBACK_MODEL_PRICING: ModelPricing = {
  inputUsdPer1M: 2.5,
  cachedInputUsdPer1M: 0.25,
  outputUsdPer1M: 15,
};

// Rough defaults aligned to current OpenAI API pricing bands as of 2026-06-12.
// Sources:
// - https://developers.openai.com/api/docs/pricing
// - https://developers.openai.com/api/docs/models/gpt-5.2-codex
// - https://developers.openai.com/api/docs/models/gpt-5.3-codex
const MODEL_PRICING: Array<{ prefix: string; pricing: ModelPricing }> = [
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

export async function getModelUsageSummary(
  range: ModelUsageRange,
  periodStart?: number,
): Promise<ModelUsageSummary> {
  const generatedAt = Date.now();
  const since =
    range === "all"
      ? 0
      : range === "period" || range === "sub_period"
        ? Math.max(0, periodStart ?? generatedAt - RANGE_TO_MS["7d"])
        : generatedAt - RANGE_TO_MS[range];
  const timelineGranularity = resolveTimelineGranularity(range);
  const sessionsDir = path.join(resolveCodexHome(), "sessions");
  const rangeFiles = findRolloutFiles(sessionsDir, range === "all" ? 0 : since - DAY_MS);

  const byModel = new Map<string, MutableModelUsageRow>();
  const timelineBuckets = new Map<number, TimelineBucket>();
  for (const filePath of rangeFiles) {
    await collectFileUsage(
      filePath,
      since,
      byModel,
      timelineBuckets,
      timelineGranularity,
    );
  }

  const models = [...byModel.values()].sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) {
      return b.totalTokens - a.totalTokens;
    }
    if (b.requests !== a.requests) {
      return b.requests - a.requests;
    }
    return a.model.localeCompare(b.model);
  });

  const totals = models.reduce(
    (acc, model) => {
      acc.requests += model.requests;
      acc.inputTokens += model.inputTokens;
      acc.cachedInputTokens += model.cachedInputTokens;
      acc.outputTokens += model.outputTokens;
      acc.reasoningOutputTokens += model.reasoningOutputTokens;
      acc.totalTokens += model.totalTokens;
      acc.estimatedCostUsd += model.estimatedCostUsd;
      return acc;
    },
    {
      requests: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    },
  );

  const timeline = buildContinuousTimeline({
    timelineBuckets,
    granularity: timelineGranularity,
    range,
    since,
    generatedAt,
  });
  const monthly = aggregateMonthlyFromTimeline(timeline);
  const monthProjection =
    (await calculateCurrentMonthProjection(sessionsDir, generatedAt)) ??
    calculateCurrentMonthProjectionFromTimeline(timeline, generatedAt);

  return {
    range,
    generatedAt,
    source: "rollout",
    models,
    totals,
    monthProjection,
    timeline: {
      granularity: timelineGranularity,
      buckets: timeline,
    },
    monthly,
    heatmap: {
      cells: [],
    },
  };
}

export async function getAllTimeModelUsageHeatmap(): Promise<ModelUsageHeatmapData> {
  const generatedAt = Date.now();
  const codexHome = resolveCodexHome();
  const roots = [
    path.join(codexHome, "sessions"),
    path.join(codexHome, "archived_sessions"),
  ];

  const heatmapBuckets = new Map<string, HeatmapBucket>();
  for (const root of roots) {
    const files = findRolloutFiles(root, 0);
    for (const filePath of files) {
      await collectHeatmapUsage(filePath, heatmapBuckets);
    }
  }

  return {
    generatedAt,
    cells: buildWeeklyHeatmap(heatmapBuckets),
  };
}

async function collectFileUsage(
  filePath: string,
  since: number,
  byModel: Map<string, MutableModelUsageRow>,
  timelineBuckets: Map<number, TimelineBucket>,
  timelineGranularity: TimelineGranularity,
) {
  let content: string;
  try {
    content = await fs.promises.readFile(filePath, "utf8");
  } catch {
    return;
  }

  const lines = content.split(/\r?\n/);
  const turnIdToModel = new Map<string, string>();
  const countedTurns = new Set<string>();
  let currentModel = "unknown";
  let previousTotalTokens: TokenTotals | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0 && index % YIELD_EVERY_LINES === 0) {
      await yieldToEventLoop();
    }
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parsed = safeJsonParse(trimmed);
    const event = toObject(parsed);
    if (!event) {
      continue;
    }

    const timestampMs = parseTimestampMs(event.timestamp);
    const payload = toObject(event.payload);

    if (event.type === "turn_context" && payload) {
      const model = normalizeModelName(payload.model);
      const turnId = typeof payload.turn_id === "string" ? payload.turn_id : null;
      if (turnId && model) {
        turnIdToModel.set(turnId, model);
      }
      if (model) {
        currentModel = model;
      }

      if (timestampMs >= since && turnId && model && !countedTurns.has(turnId)) {
        countedTurns.add(turnId);
        ensureModel(byModel, model).requests += 1;
      }
      continue;
    }

    if (event.type !== "event_msg" || !payload || payload.type !== "token_count") {
      continue;
    }

    const info = toObject(payload.info);
    if (!info) {
      continue;
    }

    const currentTotals = extractTokenTotals(info.total_token_usage);
    if (!currentTotals) {
      continue;
    }

    const delta =
      previousTotalTokens != null
        ? subtractTokenTotals(currentTotals, previousTotalTokens)
        : extractTokenTotals(info.last_token_usage) ?? emptyTokenTotals();
    previousTotalTokens = currentTotals;

    if (timestampMs < since || isZeroTokenTotals(delta)) {
      continue;
    }

    const eventTurnId = typeof payload.turn_id === "string" ? payload.turn_id : null;
    const model = normalizeModelName(
      (eventTurnId ? turnIdToModel.get(eventTurnId) : null) ?? currentModel,
    );
    const row = ensureModel(byModel, model);
    row.inputTokens += delta.inputTokens;
    row.cachedInputTokens += delta.cachedInputTokens;
    row.outputTokens += delta.outputTokens;
    row.reasoningOutputTokens += delta.reasoningOutputTokens;
    row.totalTokens += delta.totalTokens;
    row.estimatedCostUsd = estimateCostUsd(row.model, row);

    const timelineBucketStart = getTimelineBucketStart(timestampMs, timelineGranularity);
    const timelineBucket = ensureTimelineBucket(timelineBuckets, timelineBucketStart);
    timelineBucket.totalTokens += delta.totalTokens;
    timelineBucket.estimatedCostUsd += estimateCostUsd(model, delta);
  }
}

async function collectHeatmapUsage(
  filePath: string,
  heatmapBuckets: Map<string, HeatmapBucket>,
) {
  let content: string;
  try {
    content = await fs.promises.readFile(filePath, "utf8");
  } catch {
    return;
  }

  const lines = content.split(/\r?\n/);
  let previousTotalTokens: TokenTotals | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0 && index % YIELD_EVERY_LINES === 0) {
      await yieldToEventLoop();
    }
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parsed = safeJsonParse(trimmed);
    const event = toObject(parsed);
    if (!event) {
      continue;
    }

    const payload = toObject(event.payload);
    if (!payload || event.type !== "event_msg" || payload.type !== "token_count") {
      continue;
    }

    const info = toObject(payload.info);
    if (!info) {
      continue;
    }

    const currentTotals = extractTokenTotals(info.total_token_usage);
    if (!currentTotals) {
      continue;
    }

    const delta =
      previousTotalTokens != null
        ? subtractTokenTotals(currentTotals, previousTotalTokens)
        : extractTokenTotals(info.last_token_usage) ?? emptyTokenTotals();
    previousTotalTokens = currentTotals;

    if (isZeroTokenTotals(delta)) {
      continue;
    }

    const timestampMs = parseTimestampMs(event.timestamp);
    const heatmapBucket = ensureHeatmapBucket(heatmapBuckets, timestampMs);
    heatmapBucket.totalTokens += delta.totalTokens;
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function ensureModel(
  byModel: Map<string, MutableModelUsageRow>,
  model: string,
): MutableModelUsageRow {
  const normalizedModel = normalizeModelName(model);
  const existing = byModel.get(normalizedModel);
  if (existing) {
    return existing;
  }
  const created: MutableModelUsageRow = {
    model: normalizedModel,
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
  byModel.set(normalizedModel, created);
  return created;
}

function ensureTimelineBucket(
  timelineBuckets: Map<number, TimelineBucket>,
  bucketStart: number,
): TimelineBucket {
  const existing = timelineBuckets.get(bucketStart);
  if (existing) {
    return existing;
  }
  const created: TimelineBucket = {
    bucketStart,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
  timelineBuckets.set(bucketStart, created);
  return created;
}

function ensureHeatmapBucket(heatmapBuckets: Map<string, HeatmapBucket>, timestampMs: number): HeatmapBucket {
  const dayIndex = getMondayFirstDayIndex(timestampMs);
  const hour = new Date(timestampMs).getHours();
  const key = `${dayIndex}:${hour}`;
  const existing = heatmapBuckets.get(key);
  if (existing) {
    return existing;
  }
  const created: HeatmapBucket = {
    dayIndex,
    hour,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
  heatmapBuckets.set(key, created);
  return created;
}

function buildWeeklyHeatmap(
  heatmapBuckets: Map<string, HeatmapBucket>,
): Array<{ dayIndex: number; hour: number; totalTokens: number }> {
  const output: Array<{ dayIndex: number; hour: number; totalTokens: number }> = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const bucket = heatmapBuckets.get(`${dayIndex}:${hour}`);
      output.push({
        dayIndex,
        hour,
        totalTokens: bucket?.totalTokens ?? 0,
      });
    }
  }
  return output;
}

function resolveTimelineGranularity(range: ModelUsageRange): TimelineGranularity {
  switch (range) {
    case "1h":
      return "5m";
    case "6h":
      return "15m";
    case "24h":
      return "1h";
    case "7d":
      return "6h";
    case "30d":
      return "1d";
    case "period":
    case "sub_period":
      return "6h";
    case "all":
    default:
      return "1mo";
  }
}

function getTimelineBucketStart(timestampMs: number, granularity: TimelineGranularity): number {
  if (granularity === "1mo") {
    return getMonthStart(timestampMs);
  }

  const sizeMs = granularityToMs(granularity);
  if (sizeMs <= 0) {
    return timestampMs;
  }
  return Math.floor(timestampMs / sizeMs) * sizeMs;
}

function granularityToMs(granularity: Exclude<TimelineGranularity, "1mo">): number {
  switch (granularity) {
    case "5m":
      return 5 * 60 * 1000;
    case "15m":
      return 15 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "6h":
      return 6 * 60 * 60 * 1000;
    case "1d":
      return 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
}

function getMondayFirstDayIndex(timestampMs: number): number {
  const day = new Date(timestampMs).getDay();
  return (day + 6) % 7;
}

function buildContinuousTimeline(params: {
  timelineBuckets: Map<number, TimelineBucket>;
  granularity: TimelineGranularity;
  range: ModelUsageRange;
  since: number;
  generatedAt: number;
}): Array<{ bucketStart: number; totalTokens: number; estimatedCostUsd: number }> {
  const { timelineBuckets, granularity, range, since, generatedAt } = params;
  if (timelineBuckets.size === 0) {
    return [];
  }

  const keys = [...timelineBuckets.keys()].sort((a, b) => a - b);
  const startMs =
    range === "all"
      ? keys[0]
      : alignBucketStart(Math.max(0, since), granularity);
  const endMs = alignBucketStart(generatedAt, granularity);
  if (endMs < startMs) {
    return [];
  }

  const output: Array<{ bucketStart: number; totalTokens: number; estimatedCostUsd: number }> = [];
  let current = startMs;
  while (current <= endMs) {
    const existing = timelineBuckets.get(current);
    output.push({
      bucketStart: current,
      totalTokens: existing?.totalTokens ?? 0,
      estimatedCostUsd: existing?.estimatedCostUsd ?? 0,
    });
    current = nextBucketStart(current, granularity);
  }
  return output;
}

function aggregateMonthlyFromTimeline(
  timeline: Array<{ bucketStart: number; totalTokens: number; estimatedCostUsd: number }>,
): Array<{ monthStart: number; totalTokens: number; estimatedCostUsd: number }> {
  const monthly = new Map<number, { monthStart: number; totalTokens: number; estimatedCostUsd: number }>();
  for (const bucket of timeline) {
    const monthStart = getMonthStart(bucket.bucketStart);
    const existing = monthly.get(monthStart);
    if (existing) {
      existing.totalTokens += bucket.totalTokens;
      existing.estimatedCostUsd += bucket.estimatedCostUsd;
      continue;
    }
    monthly.set(monthStart, {
      monthStart,
      totalTokens: bucket.totalTokens,
      estimatedCostUsd: bucket.estimatedCostUsd,
    });
  }
  return [...monthly.values()].sort((a, b) => a.monthStart - b.monthStart);
}

async function calculateCurrentMonthProjection(
  sessionsDir: string,
  generatedAt: number,
): Promise<MonthProjection | null> {
  const monthStart = getMonthStart(generatedAt);
  const monthEnd = getNextMonthStart(monthStart);
  let monthFiles = findRolloutFiles(sessionsDir, monthStart - DAY_MS);
  if (monthFiles.length === 0) {
    monthFiles = findRolloutFiles(sessionsDir, 0);
  }
  if (monthFiles.length === 0) {
    return null;
  }

  let tokensSoFar = 0;
  let estimatedCostSoFar = 0;
  for (const filePath of monthFiles) {
    const totals = await collectMonthTotalsFromFile(filePath, monthStart, generatedAt);
    tokensSoFar += totals.totalTokens;
    estimatedCostSoFar += totals.estimatedCostUsd;
  }

  const elapsedMs = Math.max(1, generatedAt - monthStart);
  const totalMs = Math.max(1, monthEnd - monthStart);
  const elapsedRatio = Math.max(0.001, Math.min(1, elapsedMs / totalMs));
  const projectedTokens = tokensSoFar / elapsedRatio;
  const projectedCostUsd = estimatedCostSoFar / elapsedRatio;

  return {
    monthStart,
    monthEnd,
    elapsedRatio,
    tokensSoFar,
    estimatedCostSoFar,
    projectedTokens,
    projectedCostUsd,
  };
}

function calculateCurrentMonthProjectionFromTimeline(
  timeline: Array<{ bucketStart: number; totalTokens: number; estimatedCostUsd: number }>,
  generatedAt: number,
): MonthProjection | null {
  if (timeline.length === 0) {
    return null;
  }
  const monthStart = getMonthStart(generatedAt);
  const monthEnd = getNextMonthStart(monthStart);
  const inMonth = timeline.filter(
    (bucket) => bucket.bucketStart >= monthStart && bucket.bucketStart <= generatedAt,
  );
  if (inMonth.length === 0) {
    return null;
  }

  let tokensSoFar = 0;
  let estimatedCostSoFar = 0;
  for (const bucket of inMonth) {
    tokensSoFar += bucket.totalTokens;
    estimatedCostSoFar += bucket.estimatedCostUsd;
  }
  const elapsedMs = Math.max(1, generatedAt - monthStart);
  const totalMs = Math.max(1, monthEnd - monthStart);
  const elapsedRatio = Math.max(0.001, Math.min(1, elapsedMs / totalMs));

  return {
    monthStart,
    monthEnd,
    elapsedRatio,
    tokensSoFar,
    estimatedCostSoFar,
    projectedTokens: tokensSoFar / elapsedRatio,
    projectedCostUsd: estimatedCostSoFar / elapsedRatio,
  };
}

async function collectMonthTotalsFromFile(
  filePath: string,
  monthStart: number,
  generatedAt: number,
): Promise<{ totalTokens: number; estimatedCostUsd: number }> {
  let content: string;
  try {
    content = await fs.promises.readFile(filePath, "utf8");
  } catch {
    return { totalTokens: 0, estimatedCostUsd: 0 };
  }

  const lines = content.split(/\r?\n/);
  const turnIdToModel = new Map<string, string>();
  let currentModel = "unknown";
  let previousTotalTokens: TokenTotals | null = null;
  let totalTokens = 0;
  let estimatedCostUsd = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0 && index % YIELD_EVERY_LINES === 0) {
      await yieldToEventLoop();
    }
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parsed = safeJsonParse(trimmed);
    const event = toObject(parsed);
    if (!event) {
      continue;
    }

    const timestampMs = parseTimestampMs(event.timestamp);
    if (timestampMs <= 0 || timestampMs < monthStart || timestampMs > generatedAt) {
      continue;
    }
    const payload = toObject(event.payload);

    if (event.type === "turn_context" && payload) {
      const model = normalizeModelName(payload.model);
      const turnId = typeof payload.turn_id === "string" ? payload.turn_id : null;
      if (turnId && model) {
        turnIdToModel.set(turnId, model);
      }
      if (model) {
        currentModel = model;
      }
      continue;
    }

    if (event.type !== "event_msg" || !payload || payload.type !== "token_count") {
      continue;
    }

    const info = toObject(payload.info);
    if (!info) {
      continue;
    }

    const currentTotals = extractTokenTotals(info.total_token_usage);
    if (!currentTotals) {
      continue;
    }
    const delta =
      previousTotalTokens != null
        ? subtractTokenTotals(currentTotals, previousTotalTokens)
        : extractTokenTotals(info.last_token_usage) ?? emptyTokenTotals();
    previousTotalTokens = currentTotals;
    if (isZeroTokenTotals(delta)) {
      continue;
    }

    const eventTurnId = typeof payload.turn_id === "string" ? payload.turn_id : null;
    const model = normalizeModelName(
      (eventTurnId ? turnIdToModel.get(eventTurnId) : null) ?? currentModel,
    );
    totalTokens += delta.totalTokens;
    estimatedCostUsd += estimateCostUsd(model, delta);
  }

  return { totalTokens, estimatedCostUsd };
}

function alignBucketStart(timestampMs: number, granularity: TimelineGranularity): number {
  if (granularity === "1mo") {
    return getMonthStart(timestampMs);
  }
  const sizeMs = granularityToMs(granularity);
  if (sizeMs <= 0) {
    return timestampMs;
  }
  return Math.floor(timestampMs / sizeMs) * sizeMs;
}

function nextBucketStart(bucketStart: number, granularity: TimelineGranularity): number {
  if (granularity === "1mo") {
    const date = new Date(bucketStart);
    date.setMonth(date.getMonth() + 1);
    return date.getTime();
  }
  const sizeMs = granularityToMs(granularity);
  return bucketStart + sizeMs;
}

function getMonthStart(timestampMs: number): number {
  const date = new Date(timestampMs);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getNextMonthStart(monthStartMs: number): number {
  const date = new Date(monthStartMs);
  date.setMonth(date.getMonth() + 1);
  return date.getTime();
}

function normalizeModelName(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return "unknown";
}

function estimateCostUsd(model: string, usage: TokenTotals): number {
  const pricing = resolveModelPricing(model);
  // Cached input tokens are a discounted subset of input tokens, not an extra bucket.
  const cachedInputTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const uncachedInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);
  const inputCost = (uncachedInputTokens / 1_000_000) * pricing.inputUsdPer1M;
  const cachedInputCost = (cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPer1M;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputUsdPer1M;
  const estimated = inputCost + cachedInputCost + outputCost;
  if (!Number.isFinite(estimated) || estimated <= 0) {
    return 0;
  }
  return estimated;
}

function resolveModelPricing(model: string): ModelPricing {
  const normalized = model.toLowerCase();
  for (const candidate of MODEL_PRICING) {
    if (normalized.startsWith(candidate.prefix)) {
      return candidate.pricing;
    }
  }
  return FALLBACK_MODEL_PRICING;
}

function extractTokenTotals(value: unknown): TokenTotals | null {
  const object = toObject(value);
  if (!object) {
    return null;
  }

  return {
    inputTokens: normalizeCounter(object.input_tokens),
    cachedInputTokens: normalizeCounter(object.cached_input_tokens),
    outputTokens: normalizeCounter(object.output_tokens),
    reasoningOutputTokens: normalizeCounter(object.reasoning_output_tokens),
    totalTokens: normalizeCounter(object.total_tokens),
  };
}

function subtractTokenTotals(current: TokenTotals, previous: TokenTotals): TokenTotals {
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(
      0,
      current.reasoningOutputTokens - previous.reasoningOutputTokens,
    ),
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens),
  };
}

function emptyTokenTotals(): TokenTotals {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function isZeroTokenTotals(value: TokenTotals): boolean {
  return (
    value.inputTokens <= 0 &&
    value.cachedInputTokens <= 0 &&
    value.outputTokens <= 0 &&
    value.reasoningOutputTokens <= 0 &&
    value.totalTokens <= 0
  );
}

function normalizeCounter(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }
  return 0;
}

function parseTimestampMs(value: unknown): number {
  if (typeof value !== "string") {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findRolloutFiles(rootDir: string, mtimeCutoffMs: number): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const queue: string[] = [rootDir];
  const files: Array<{ path: string; mtimeMs: number }> = [];

  while (queue.length > 0) {
    const current = queue.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) {
        continue;
      }
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs >= mtimeCutoffMs) {
          files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // ignore unreadable files
      }
    }
  }

  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return files.map((file) => file.path);
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
