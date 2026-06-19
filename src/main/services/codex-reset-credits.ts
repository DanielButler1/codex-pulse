import type { CodexResetCredit, CodexResetCreditsResult } from "../../../shared/types";
import { loadCodexAuth } from "./codex-auth";

const RESET_CREDITS_ENDPOINT =
  "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

export async function fetchCodexResetCredits(): Promise<CodexResetCreditsResult> {
  const checkedAt = Date.now();
  const auth = await loadCodexAuth();
  if (auth.status === "error") {
    return emptyResult(checkedAt, auth.authMessage);
  }
  if (!auth.accountId) {
    return emptyResult(checkedAt, "Codex auth does not include an account ID.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(RESET_CREDITS_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "ChatGPT-Account-ID": auth.accountId,
        "OpenAI-Beta": "codex-1",
        originator: "Codex Desktop",
        accept: "application/json",
        "user-agent": "codex-pulse",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return emptyResult(
        checkedAt,
        response.status === 401
          ? "Codex auth expired. Open Codex or run `codex login`, then refresh."
          : `Reset credits endpoint returned HTTP ${response.status}.`,
      );
    }

    const payload = (await response.json()) as unknown;
    return normalizeResetCredits(payload, checkedAt);
  } catch {
    return emptyResult(checkedAt, "Reset credits could not be loaded.");
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeResetCredits(
  payload: unknown,
  checkedAt: number,
): CodexResetCreditsResult {
  const root = toObject(payload);
  if (!root) {
    return emptyResult(checkedAt, "Reset credits response was not valid JSON.");
  }

  const credits = Array.isArray(root.credits)
    ? root.credits.map(normalizeResetCredit).filter((credit): credit is CodexResetCredit => credit != null)
    : [];
  const availableCount =
    toNumber(root.available_count) ??
    toNumber(root.availableCount) ??
    credits.filter((credit) => credit.status === "available").length;

  return {
    checkedAt,
    credits,
    availableCount,
    totalEarnedCount: toNumber(root.total_earned_count) ?? toNumber(root.totalEarnedCount),
    error: null,
  };
}

function normalizeResetCredit(value: unknown): CodexResetCredit | null {
  const credit = toObject(value);
  if (!credit) {
    return null;
  }

  const id = pickString([credit.id, credit.credit_id, credit.creditId]);
  if (!id) {
    return null;
  }

  return {
    id,
    resetType: pickString([credit.reset_type, credit.resetType]),
    status: pickString([credit.status])?.toLowerCase() ?? "unknown",
    grantedAt: parseDateMs(credit.granted_at) ?? parseDateMs(credit.grantedAt),
    expiresAt: parseDateMs(credit.expires_at) ?? parseDateMs(credit.expiresAt),
    title: pickString([credit.title]),
    description: pickString([credit.description]),
  };
}

function emptyResult(checkedAt: number, error: string | null): CodexResetCreditsResult {
  return {
    checkedAt,
    credits: [],
    availableCount: 0,
    totalEarnedCount: null,
    error,
  };
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function pickString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function parseDateMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
