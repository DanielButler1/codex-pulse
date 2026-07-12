import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCodexLimitWindows } from "./codex-limit-windows.ts";
import type { UsageSnapshot } from "./types.ts";

function snapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    checkedAt: 1_700_000_000_000,
    provider: "codex",
    primaryUsedPercent: null,
    primaryResetAfterSeconds: null,
    primaryWindowMinutes: null,
    secondaryUsedPercent: null,
    secondaryResetAfterSeconds: null,
    secondaryWindowMinutes: null,
    ...overrides,
  };
}

test("moves a lone weekly window from primary to secondary", () => {
  const actual = normalizeCodexLimitWindows(
    snapshot({
      primaryUsedPercent: 34,
      primaryResetAfterSeconds: 500_000,
      primaryWindowMinutes: 10_080,
    }),
  );

  assert.equal(actual.primaryUsedPercent, null);
  assert.equal(actual.primaryWindowMinutes, null);
  assert.equal(actual.secondaryUsedPercent, 34);
  assert.equal(actual.secondaryResetAfterSeconds, 500_000);
  assert.equal(actual.secondaryWindowMinutes, 10_080);
});

test("keeps the normal short and weekly window layout", () => {
  const input = snapshot({
    primaryUsedPercent: 12,
    primaryWindowMinutes: 300,
    secondaryUsedPercent: 34,
    secondaryWindowMinutes: 10_080,
  });

  assert.equal(normalizeCodexLimitWindows(input), input);
});

test("orders two reported windows by duration", () => {
  const actual = normalizeCodexLimitWindows(
    snapshot({
      primaryUsedPercent: 34,
      primaryWindowMinutes: 10_080,
      secondaryUsedPercent: 12,
      secondaryWindowMinutes: 300,
    }),
  );

  assert.equal(actual.primaryUsedPercent, 12);
  assert.equal(actual.primaryWindowMinutes, 300);
  assert.equal(actual.secondaryUsedPercent, 34);
  assert.equal(actual.secondaryWindowMinutes, 10_080);
});

test("moves a lone short window from secondary to primary", () => {
  const actual = normalizeCodexLimitWindows(
    snapshot({
      secondaryUsedPercent: 12,
      secondaryResetAfterSeconds: 3_600,
      secondaryWindowMinutes: 300,
    }),
  );

  assert.equal(actual.primaryUsedPercent, 12);
  assert.equal(actual.primaryWindowMinutes, 300);
  assert.equal(actual.secondaryUsedPercent, null);
  assert.equal(actual.secondaryWindowMinutes, null);
});
