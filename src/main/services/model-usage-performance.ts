import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type {
  ModelUsagePerformance,
  ModelUsagePerformanceDay,
  ModelUsagePerformanceTotals,
  ModelUsageRange,
} from "../../../shared/types";
import { resolveCodexHome } from "./codex-auth.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_TO_MS = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
} as const;
const ACTIVE_ITEM_TYPES = new Set(["Reasoning", "AgentMessage"]);

type PerformanceBucket = {
  dayStart: number;
  model: string;
  responseCount: number;
  outputTokens: number;
  durationMs: number;
  estimatedResponseCount: number;
  responseDurationsMs: number[];
};

type RolloutFile = {
  filePath: string;
  modifiedAt: number;
};

export async function getModelUsagePerformance(
  range: ModelUsageRange,
  periodStart?: number,
  signal?: AbortSignal,
): Promise<ModelUsagePerformance> {
  const generatedAt = Date.now();
  const since = resolveSince(range, periodStart, generatedAt);
  const files = findRolloutFiles(since > 0 ? Math.max(0, since - DAY_MS) : 0);
  const buckets = new Map<string, PerformanceBucket>();

  for (const file of files) {
    throwIfAborted(signal);
    try {
      await collectFilePerformance(file.filePath, since, buckets, signal);
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
  }

  const daily = [...buckets.values()]
    .map(toPerformanceDay)
    .sort((a, b) => a.dayStart - b.dayStart || a.model.localeCompare(b.model));

  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
    daily,
    totals: toPerformanceTotals([...buckets.values()]),
  };
}

async function collectFilePerformance(
  filePath: string,
  since: number,
  buckets: Map<string, PerformanceBucket>,
  signal?: AbortSignal,
): Promise<void> {
  const turnIdToModel = new Map<string, string>();
  const durationByTurn = new Map<string, number>();
  const responseIds = new Set<string>();
  const lastResponseAtByModel = new Map<string, number>();
  let currentModel = "unknown";

  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      throwIfAborted(signal);
      const event = toObject(safeJsonParse(line));
      if (!event) continue;

      const payload = toObject(event.payload);
      const eventType = typeof event.type === "string" ? event.type : "";
      const turnId = typeof payload?.turn_id === "string" ? payload.turn_id : null;

      if (eventType === "turn_context" && payload) {
        const model = normalizeModel(payload.model);
        if (turnId) turnIdToModel.set(turnId, model);
        currentModel = model;
        continue;
      }

      if (eventType === "event_msg" && payload?.type === "item_completed") {
        const item = toObject(payload.item);
        const itemType = typeof item?.type === "string" ? item.type : null;
        if (!turnId || !itemType || !ACTIVE_ITEM_TYPES.has(itemType)) continue;
        const startedAt = numberValue(payload.started_at_ms);
        const completedAt = numberValue(payload.completed_at_ms);
        if (startedAt == null || completedAt == null || completedAt <= startedAt) continue;
        durationByTurn.set(turnId, (durationByTurn.get(turnId) ?? 0) + completedAt - startedAt);
        continue;
      }

      if (eventType !== "token_usage_record" || !payload) continue;
      const usage = toObject(payload.usage);
      const outputTokens = counter(usage?.output_tokens);
      const responseId = typeof payload.response_id === "string" ? payload.response_id : null;
      if (!usage || !responseId || responseIds.has(responseId)) continue;
      responseIds.add(responseId);

      const timestampMs = parseTimestampMs(event.timestamp);
      if (timestampMs <= 0 || timestampMs < since) continue;

      const model = (turnId ? turnIdToModel.get(turnId) : null) ?? currentModel;
      const exactDurationMs = turnId ? durationByTurn.get(turnId) ?? 0 : 0;
      if (turnId) durationByTurn.delete(turnId);

      let durationMs = exactDurationMs;
      let estimated = false;
      if (durationMs <= 0) {
        const previousResponseAt = lastResponseAtByModel.get(model);
        if (previousResponseAt != null && timestampMs > previousResponseAt) {
          durationMs = timestampMs - previousResponseAt;
          estimated = true;
        }
      }
      lastResponseAtByModel.set(model, timestampMs);

      const bucket = ensureBucket(buckets, getLocalDayStart(timestampMs), model);
      bucket.responseCount += 1;
      bucket.outputTokens += outputTokens;
      if (durationMs > 0) {
        bucket.durationMs += durationMs;
        bucket.responseDurationsMs.push(durationMs);
      }
      if (estimated) bucket.estimatedResponseCount += 1;
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

function findRolloutFiles(minModifiedAt: number): RolloutFile[] {
  const home = resolveCodexHome();
  const queue = [path.join(home, "sessions"), path.join(home, "archived_sessions")];
  const files: RolloutFile[] = [];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;
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
      if (!entry.isFile() || !entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) continue;
      try {
        const modifiedAt = fs.statSync(fullPath).mtimeMs;
        if (modifiedAt >= minModifiedAt) files.push({ filePath: fullPath, modifiedAt });
      } catch {
        // A live rollout may be moved while the directory is being scanned.
      }
    }
  }

  return files.sort((a, b) => a.modifiedAt - b.modifiedAt);
}

function resolveSince(range: ModelUsageRange, periodStart: number | undefined, generatedAt: number): number {
  if (range === "all") return 0;
  if (range === "period" || range === "sub_period") return Math.max(0, periodStart ?? generatedAt - RANGE_TO_MS["7d"]);
  return generatedAt - RANGE_TO_MS[range];
}

function ensureBucket(
  buckets: Map<string, PerformanceBucket>,
  dayStart: number,
  model: string,
): PerformanceBucket {
  const key = `${dayStart}:${model}`;
  const existing = buckets.get(key);
  if (existing) return existing;
  const created: PerformanceBucket = {
    dayStart,
    model,
    responseCount: 0,
    outputTokens: 0,
    durationMs: 0,
    estimatedResponseCount: 0,
    responseDurationsMs: [],
  };
  buckets.set(key, created);
  return created;
}

function toPerformanceDay(bucket: PerformanceBucket): ModelUsagePerformanceDay {
  return {
    dayStart: bucket.dayStart,
    model: bucket.model,
    responseCount: bucket.responseCount,
    outputTokens: bucket.outputTokens,
    durationMs: bucket.durationMs,
    throughputTokensPerSecond: calculateThroughput(bucket.outputTokens, bucket.durationMs),
    medianResponseDurationMs: percentile(bucket.responseDurationsMs, 0.5),
    p95ResponseDurationMs: percentile(bucket.responseDurationsMs, 0.95),
    estimatedResponseCount: bucket.estimatedResponseCount,
  };
}

function toPerformanceTotals(buckets: PerformanceBucket[]): ModelUsagePerformanceTotals {
  const responseDurationsMs = buckets.flatMap((bucket) => bucket.responseDurationsMs);
  const responseCount = buckets.reduce((sum, bucket) => sum + bucket.responseCount, 0);
  const outputTokens = buckets.reduce((sum, bucket) => sum + bucket.outputTokens, 0);
  const durationMs = buckets.reduce((sum, bucket) => sum + bucket.durationMs, 0);
  return {
    responseCount,
    outputTokens,
    durationMs,
    throughputTokensPerSecond: calculateThroughput(outputTokens, durationMs),
    medianResponseDurationMs: percentile(responseDurationsMs, 0.5),
    p95ResponseDurationMs: percentile(responseDurationsMs, 0.95),
    estimatedResponseCount: buckets.reduce((sum, bucket) => sum + bucket.estimatedResponseCount, 0),
  };
}

function calculateThroughput(outputTokens: number, durationMs: number): number | null {
  return outputTokens > 0 && durationMs > 0 ? outputTokens / (durationMs / 1000) : null;
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index] ?? null;
}

function getLocalDayStart(timestampMs: number): number {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function normalizeModel(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

function counter(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestampMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Model usage performance cancelled", "AbortError");
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}
