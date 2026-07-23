import assert from "node:assert/strict";
import test from "node:test";
import { findNextAvailableManualResetAt } from "./projection-reset.ts";
import type { CodexResetCreditsResult } from "./types.ts";

const NOW = 1_800_000_000_000;

function resetCredits(
  credits: CodexResetCreditsResult["credits"],
): CodexResetCreditsResult {
  return {
    checkedAt: NOW,
    credits,
    availableCount: credits.length,
    totalEarnedCount: credits.length,
    error: null,
  };
}

function credit(
  id: string,
  expiresAt: number | null,
  status = "available",
): CodexResetCreditsResult["credits"][number] {
  return {
    id,
    resetType: null,
    status,
    grantedAt: NOW - 1_000,
    expiresAt,
    title: null,
    description: null,
  };
}

test("returns the earliest future available manual reset", () => {
  const result = findNextAvailableManualResetAt(
    resetCredits([
      credit("later", NOW + 20_000),
      credit("next", NOW + 10_000),
    ]),
    NOW,
  );

  assert.equal(result, NOW + 10_000);
});

test("ignores expired, unavailable, and undated reset credits", () => {
  const result = findNextAvailableManualResetAt(
    resetCredits([
      credit("expired", NOW - 1),
      credit("used", NOW + 10_000, "used"),
      credit("undated", null),
    ]),
    NOW,
  );

  assert.equal(result, null);
});

test("returns null when reset credits have not loaded", () => {
  assert.equal(findNextAvailableManualResetAt(null, NOW), null);
});
