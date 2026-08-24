import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ModelUsageRollup, UsageDatabase } from "../src/main/db.ts";
import { updateModelUsageRollups } from "../src/main/services/model-usage-index.ts";

test("indexes incrementally, tracks moved files, and rebuilds on version changes", async () => {
  const fixture = createFixture();
  const store = new MemoryRollupStore();
  try {
    await updateModelUsageRollups(store.asDatabase(), undefined, undefined, "test-v1");
    assert.equal(store.replacements, 1);
    assertTotals(store, 1, 120);

    await updateModelUsageRollups(store.asDatabase(), undefined, undefined, "test-v1");
    assert.equal(store.replacements, 1, "unchanged files should not be parsed again");

    fs.appendFileSync(fixture.rollout, `${tokenEvent("2026-08-23T10:06:00.000Z", 150, 30)}\n`);
    await updateModelUsageRollups(store.asDatabase(), undefined, undefined, "test-v1");
    assert.equal(store.replacements, 2);
    assertTotals(store, 1, 180);

    const archivedDir = path.join(fixture.root, "archived_sessions");
    fs.mkdirSync(archivedDir, { recursive: true });
    const archived = path.join(archivedDir, path.basename(fixture.rollout));
    fs.renameSync(fixture.rollout, archived);
    await updateModelUsageRollups(store.asDatabase(), undefined, undefined, "test-v1");
    assert.equal(store.files.size, 1);
    assert.ok(store.files.has(archived));
    assertTotals(store, 1, 180);

    await updateModelUsageRollups(store.asDatabase(), undefined, undefined, "test-v2");
    assert.equal(store.version, "test-v2");
    assert.equal(store.replacements, 4, "a version change should rebuild every current file");
    assertTotals(store, 1, 180);
  } finally {
    fixture.cleanup();
  }
});

test("does not commit work when indexing is already cancelled", async () => {
  const fixture = createFixture();
  const store = new MemoryRollupStore();
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      updateModelUsageRollups(store.asDatabase(), controller.signal, undefined, "cancel-test"),
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
    assert.equal(store.replacements, 0);
  } finally {
    fixture.cleanup();
  }
});

test("ignores replayed token counts that precede the first turn context", async () => {
  const fixture = createFixture();
  const store = new MemoryRollupStore();
  try {
    // Resumed Codex Desktop sessions replay the parent thread's history before
    // any turn_context: historical token_count events with no turn_id that were
    // already counted in the original rollout file.
    fs.writeFileSync(fixture.rollout, [
      JSON.stringify({ timestamp: "2026-08-23T10:00:00.000Z", type: "session_meta", payload: { session_id: "parent" } }),
      JSON.stringify({ timestamp: "2026-08-23T10:00:01.000Z", type: "event_msg", payload: { type: "user_message" } }),
      tokenCountEvent("2026-08-23T10:00:02.000Z", null, 900, 100),
      tokenCountEvent("2026-08-23T10:00:03.000Z", null, 1100, 120),
      JSON.stringify({ timestamp: "2026-08-23T10:00:04.000Z", type: "event_msg", payload: { type: "agent_message" } }),
      JSON.stringify({ timestamp: "2026-08-23T10:00:05.000Z", type: "turn_context", payload: { turn_id: "live", model: "gpt-test" } }),
      tokenCountEvent("2026-08-23T10:00:06.000Z", "live", 1300, 140),
    ].join("\n") + "\n");

    await updateModelUsageRollups(store.asDatabase(), undefined, undefined, "replay-test-v1");

    const rows = [...store.rows.values()].flat();
    assert.equal(rows.length, 1, "only the live turn should be attributed");
    const row = rows[0];
    assert.equal(row.model, "gpt-test");
    assert.equal(row.requests, 1);
    // Delta comes from the cumulative totals across the replay boundary
    // (1440 - 1220), not from last_token_usage.
    assert.equal(row.totalTokens, 220);
    assert.equal(row.inputTokens, 200);
    assert.equal(row.outputTokens, 20);
  } finally {
    fixture.cleanup();
  }
});

class MemoryRollupStore {
  version = "";
  replacements = 0;
  files = new Map<string, { sizeBytes: number; modifiedAt: number }>();
  rows = new Map<string, ModelUsageRollup[]>();

  asDatabase(): UsageDatabase {
    return this as unknown as UsageDatabase;
  }

  ensureModelUsageIndexVersion(version: string): boolean {
    if (this.version === version) return false;
    this.version = version;
    this.files.clear();
    this.rows.clear();
    return true;
  }

  getModelUsageFileStates() {
    return new Map(this.files);
  }

  replaceModelUsageFile(file: { filePath: string; sizeBytes: number; modifiedAt: number }, rows: ModelUsageRollup[]) {
    this.replacements += 1;
    this.files.set(file.filePath, { sizeBytes: file.sizeBytes, modifiedAt: file.modifiedAt });
    this.rows.set(file.filePath, rows);
  }

  removeMissingModelUsageFiles(existingPaths: Set<string>) {
    for (const filePath of this.files.keys()) {
      if (!existingPaths.has(filePath)) {
        this.files.delete(filePath);
        this.rows.delete(filePath);
      }
    }
  }
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-pulse-index-"));
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = root;
  const sessions = path.join(root, "sessions", "2026", "08", "23");
  fs.mkdirSync(sessions, { recursive: true });
  const rollout = path.join(sessions, "rollout-test.jsonl");
  fs.writeFileSync(rollout, [
    JSON.stringify({ timestamp: "2026-08-23T10:00:00.000Z", type: "turn_context", payload: { turn_id: "one", model: "gpt-test" } }),
    tokenEvent("2026-08-23T10:01:00.000Z", 100, 20),
  ].join("\n") + "\n");
  return {
    root,
    rollout,
    cleanup() {
      process.env.CODEX_HOME = previousHome;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function tokenEvent(timestamp: string, input: number, output: number): string {
  return tokenCountEvent(timestamp, "one", input, output);
}

function tokenCountEvent(timestamp: string, turnId: string | null, input: number, output: number): string {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      ...(turnId ? { turn_id: turnId } : {}),
      info: {
        total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output },
        last_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output },
      },
    },
  });
}

function assertTotals(store: MemoryRollupStore, requests: number, totalTokens: number) {
  const rows = [...store.rows.values()].flat();
  assert.equal(rows.reduce((sum, row) => sum + row.requests, 0), requests);
  assert.equal(rows.reduce((sum, row) => sum + row.totalTokens, 0), totalTokens);
}
