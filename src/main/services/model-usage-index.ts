import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { ModelUsageRollup, UsageDatabase } from "../db";
import { resolveCodexHome } from "./codex-auth.ts";
import { estimateIndexedCostUsd } from "./model-usage-pricing.ts";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
// Increment whenever parsing, bucketing, or pricing semantics change. Existing
// rows are rebuilt automatically so cached totals never mix algorithms.
export const MODEL_USAGE_INDEX_VERSION = "3";

type TokenTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

type RolloutFile = { filePath: string; sizeBytes: number; modifiedAt: number };

const inflightUpdates = new WeakMap<UsageDatabase, Promise<void>>();

export async function updateModelUsageRollups(
  db: UsageDatabase,
  signal?: AbortSignal,
  onProgress?: (processedFiles: number, totalFiles: number) => void,
  indexVersion = MODEL_USAGE_INDEX_VERSION,
): Promise<void> {
  const inflight = inflightUpdates.get(db);
  if (inflight) {
    await inflight;
    throwIfAborted(signal);
    return;
  }
  const update = performModelUsageRollupUpdate(db, signal, onProgress, indexVersion);
  inflightUpdates.set(db, update);
  try {
    await update;
  } finally {
    if (inflightUpdates.get(db) === update) inflightUpdates.delete(db);
  }
}

async function performModelUsageRollupUpdate(
  db: UsageDatabase,
  signal?: AbortSignal,
  onProgress?: (processedFiles: number, totalFiles: number) => void,
  indexVersion = MODEL_USAGE_INDEX_VERSION,
): Promise<void> {
  db.ensureModelUsageIndexVersion(indexVersion);
  const files = findRolloutFiles();
  const existingPaths = new Set(files.map((file) => file.filePath));
  const states = db.getModelUsageFileStates();
  const changed = files.filter((file) => {
    const state = states.get(file.filePath);
    return !state || state.sizeBytes !== file.sizeBytes || state.modifiedAt !== file.modifiedAt;
  });

  onProgress?.(0, changed.length);
  for (let index = 0; index < changed.length; index += 1) {
    throwIfAborted(signal);
    const file = changed[index];
    const rollups = await parseRolloutFile(file.filePath, signal);
    throwIfAborted(signal);
    db.replaceModelUsageFile(file, rollups);
    onProgress?.(index + 1, changed.length);
  }
  throwIfAborted(signal);
  db.removeMissingModelUsageFiles(existingPaths);
}

async function parseRolloutFile(filePath: string, signal?: AbortSignal): Promise<ModelUsageRollup[]> {
  const buckets = new Map<string, ModelUsageRollup>();
  const turnIdToModel = new Map<string, string>();
  const countedTurns = new Set<string>();
  let currentModel = "unknown";
  // Resumed Codex Desktop sessions replay the parent thread's history (including
  // historical token_count events) before the first turn_context. Those events
  // carry no model information and duplicate usage already recorded in the
  // original rollout file, so they must not be attributed.
  let sawTurnContext = false;
  let previousTotalTokens: TokenTotals | null = null;
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      throwIfAborted(signal);
      const event = toObject(safeJsonParse(line));
      if (!event) continue;
      const timestampMs = parseTimestampMs(event.timestamp);
      if (timestampMs <= 0) continue;
      const payload = toObject(event.payload);

      if (event.type === "turn_context" && payload) {
        sawTurnContext = true;
        const model = normalizeModel(payload.model);
        const turnId = typeof payload.turn_id === "string" ? payload.turn_id : null;
        if (turnId) turnIdToModel.set(turnId, model);
        currentModel = model;
        if (turnId && !countedTurns.has(turnId)) {
          countedTurns.add(turnId);
          ensureBucket(buckets, timestampMs, model).requests += 1;
        }
        continue;
      }

      if (event.type !== "event_msg" || !payload || payload.type !== "token_count") continue;
      const info = toObject(payload.info);
      const currentTotals = extractTokenTotals(info?.total_token_usage);
      if (!currentTotals) continue;
      const delta = previousTotalTokens
        ? subtractTokenTotals(currentTotals, previousTotalTokens)
        : extractTokenTotals(info?.last_token_usage) ?? emptyTokenTotals();
      previousTotalTokens = currentTotals;
      if (!sawTurnContext) continue;
      if (delta.totalTokens <= 0) continue;
      const turnId = typeof payload.turn_id === "string" ? payload.turn_id : null;
      const model = normalizeModel((turnId ? turnIdToModel.get(turnId) : null) ?? currentModel);
      const bucket = ensureBucket(buckets, timestampMs, model);
      bucket.inputTokens += delta.inputTokens;
      bucket.cachedInputTokens += delta.cachedInputTokens;
      bucket.outputTokens += delta.outputTokens;
      bucket.reasoningOutputTokens += delta.reasoningOutputTokens;
      bucket.totalTokens += delta.totalTokens;
      bucket.estimatedCostUsd += estimateIndexedCostUsd(model, delta);
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return [...buckets.values()];
}

function findRolloutFiles(): RolloutFile[] {
  const home = resolveCodexHome();
  const queue = [path.join(home, "sessions"), path.join(home, "archived_sessions")];
  const files: RolloutFile[] = [];
  while (queue.length > 0) {
    const current = queue.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) { queue.push(fullPath); continue; }
      if (!entry.isFile() || !entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) continue;
      try {
        const stat = fs.statSync(fullPath);
        files.push({ filePath: fullPath, sizeBytes: stat.size, modifiedAt: stat.mtimeMs });
      } catch { /* File may have been archived during discovery. */ }
    }
  }
  return files;
}

function ensureBucket(map: Map<string, ModelUsageRollup>, timestamp: number, model: string): ModelUsageRollup {
  const bucketStart = Math.floor(timestamp / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
  const key = `${bucketStart}:${model}`;
  const existing = map.get(key);
  if (existing) return existing;
  const created: ModelUsageRollup = {
    bucketStart, model, requests: 0, inputTokens: 0, cachedInputTokens: 0,
    outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, estimatedCostUsd: 0,
  };
  map.set(key, created);
  return created;
}

function extractTokenTotals(value: unknown): TokenTotals | null {
  const object = toObject(value);
  if (!object) return null;
  return {
    inputTokens: counter(object.input_tokens), cachedInputTokens: counter(object.cached_input_tokens),
    outputTokens: counter(object.output_tokens), reasoningOutputTokens: counter(object.reasoning_output_tokens),
    totalTokens: counter(object.total_tokens),
  };
}

function subtractTokenTotals(current: TokenTotals, previous: TokenTotals): TokenTotals {
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(0, current.reasoningOutputTokens - previous.reasoningOutputTokens),
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens),
  };
}

function emptyTokenTotals(): TokenTotals { return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 }; }
function counter(value: unknown): number { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0; }
function normalizeModel(value: unknown): string { return typeof value === "string" && value.trim() ? value.trim() : "unknown"; }
function parseTimestampMs(value: unknown): number { const parsed = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : 0; }
function safeJsonParse(value: string): unknown { try { return JSON.parse(value); } catch { return null; } }
function toObject(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException("Model usage indexing cancelled", "AbortError"); }
