import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ProviderConnectionSettings,
  ProviderSecretInput,
  ProviderUsageResult,
  UsageSnapshot,
} from "../../../shared/types";

const execFileAsync = promisify(execFile);

type ProviderUsageOptions = {
  settings: ProviderConnectionSettings;
  secrets: ProviderSecretInput;
};

type OpenRouterKeyData = {
  limit?: number | string | null;
  limit_remaining?: number | string | null;
  limit_reset?: string | null;
  usage?: number | string | null;
  usage_daily?: number | string | null;
  usage_weekly?: number | string | null;
  usage_monthly?: number | string | null;
  byok_usage?: number | string | null;
  byok_usage_daily?: number | string | null;
  byok_usage_weekly?: number | string | null;
  byok_usage_monthly?: number | string | null;
  is_free_tier?: boolean | null;
  is_management_key?: boolean | null;
  is_provisioning_key?: boolean | null;
  label?: string | null;
};

type OpenRouterCreditsData = {
  total_credits?: number | string | null;
  total_usage?: number | string | null;
};

type OpenRouterActivityItem = {
  date?: string | null;
  model?: string | null;
  model_permaslug?: string | null;
  endpoint_id?: string | null;
  provider_name?: string | null;
  usage?: number | string | null;
  byok_usage_inference?: number | string | null;
  requests?: number | string | null;
  prompt_tokens?: number | string | null;
  completion_tokens?: number | string | null;
  reasoning_tokens?: number | string | null;
};

export async function fetchProviderUsageNative(
  providerId: string,
  options: ProviderUsageOptions,
): Promise<ProviderUsageResult> {
  const checkedAt = Date.now();
  const { settings, secrets } = options;
  if (!settings.enabled) {
    return failed(providerId, checkedAt, "Provider is disabled in settings.");
  }

  switch (providerId) {
    case "openrouter":
      return fetchOpenRouter(checkedAt, providerId, settings, secrets);
    case "deepseek":
      return fetchDeepSeek(checkedAt, providerId, settings, secrets);
    case "claude":
      return fetchClaudeCli(checkedAt, providerId, settings);
    case "kiro":
      return fetchKiroCli(checkedAt, providerId, settings);
    case "gemini":
      return fetchGeminiCli(checkedAt, providerId, settings);
    default:
      return {
        providerId,
        checkedAt,
        source: "native",
        snapshot: null,
        error: `Native collector for '${providerId}' is not implemented yet.`,
        note: null,
      };
  }
}

async function fetchOpenRouter(
  checkedAt: number,
  providerId: string,
  settings: ProviderConnectionSettings,
  secrets: ProviderSecretInput,
): Promise<ProviderUsageResult> {
  const apiKey = secrets.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return missingConfig(providerId, checkedAt, "Add an API key in Settings > Provider config.");
  }
  try {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      ...parseHeadersJson(settings.headersJson),
    };
    const keyEndpoint = resolveUrl(settings.apiBaseUrl, "https://openrouter.ai/api/v1/key");
    const creditsEndpoint = resolveUrl(settings.apiBaseUrl, "https://openrouter.ai/api/v1/credits");
    const activityEndpoint = resolveUrl(settings.apiBaseUrl, "https://openrouter.ai/api/v1/activity");
    const [keyResult, creditsResult, activityResult] = await Promise.allSettled([
      fetch(keyEndpoint, { headers }),
      fetch(creditsEndpoint, { headers }),
      fetch(activityEndpoint, { headers }),
    ]);

    const keyData =
      keyResult.status === "fulfilled" && keyResult.value.ok
        ? (((await keyResult.value.json()) as { data?: OpenRouterKeyData }).data ?? null)
        : null;
    const creditsData =
      creditsResult.status === "fulfilled" && creditsResult.value.ok
        ? (((await creditsResult.value.json()) as { data?: OpenRouterCreditsData }).data ?? null)
        : null;

    const activityData =
      activityResult.status === "fulfilled" && activityResult.value.ok
        ? (((await activityResult.value.json()) as { data?: OpenRouterActivityItem[] }).data ?? [])
        : [];
    const keyError =
      keyResult.status === "rejected"
        ? "OpenRouter key request failed."
        : keyResult.status === "fulfilled" && !keyResult.value.ok
          ? `OpenRouter key request failed (${keyResult.value.status}).`
          : null;
    const creditsError =
      creditsResult.status === "rejected"
        ? "OpenRouter credits request failed."
        : creditsResult.status === "fulfilled" && !creditsResult.value.ok
          ? `OpenRouter credits request failed (${creditsResult.value.status}).`
          : null;
    const activityError =
      activityResult.status === "rejected"
        ? "OpenRouter activity request failed."
        : activityResult.status === "fulfilled" && !activityResult.value.ok
          ? `OpenRouter activity request failed (${activityResult.value.status}).`
          : null;

    const creditsTotalFromCredits = numberOrNull(creditsData?.total_credits);
    const totalUsageFromCredits = numberOrNull(creditsData?.total_usage);
    const totalUsageFromKey = numberOrNull(keyData?.usage);
    const totalUsage = preferNonZero(totalUsageFromCredits, totalUsageFromKey, sumActivityUsage(activityData));

    const remaining =
      creditsTotalFromCredits != null && totalUsageFromCredits != null
        ? Math.max(0, creditsTotalFromCredits - totalUsageFromCredits)
        : null;
    const usedPercent =
      creditsTotalFromCredits != null && totalUsage != null && creditsTotalFromCredits > 0
        ? clamp((totalUsage / creditsTotalFromCredits) * 100, 0, 100)
        : remaining != null && creditsTotalFromCredits != null && creditsTotalFromCredits > 0
          ? clamp(((creditsTotalFromCredits - remaining) / creditsTotalFromCredits) * 100, 0, 100)
          : null;
    const snapshot: UsageSnapshot = {
      checkedAt,
      provider: providerId,
      planType: keyData?.limit_reset ?? (keyData?.is_free_tier ? "free_tier" : undefined),
      primaryUsedPercent: usedPercent,
      primaryResetAfterSeconds: null,
      secondaryUsedPercent: null,
      secondaryResetAfterSeconds: null,
      creditsBalance: remaining,
      creditsGranted: creditsTotalFromCredits,
      creditsUsed: totalUsage,
      raw: {
        source: "openrouter-api",
        key: keyData,
        credits: creditsData,
        activity: activityData,
        keyError,
        creditsError,
        activityError,
      },
    };
    const noteParts = [keyError, creditsError, activityError].filter(Boolean);
    return {
      providerId,
      checkedAt,
      source: "openrouter-api",
      snapshot,
      error: null,
      note:
        noteParts.length > 0
          ? noteParts.join(" ")
          : creditsData == null
            ? "Management key required for wallet balance."
            : null,
    };
  } catch {
    return failed(providerId, checkedAt, "OpenRouter credits request failed.");
  }
}

async function fetchDeepSeek(
  checkedAt: number,
  providerId: string,
  settings: ProviderConnectionSettings,
  secrets: ProviderSecretInput,
): Promise<ProviderUsageResult> {
  const apiKey = secrets.apiKey ?? process.env.DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_KEY;
  if (!apiKey) {
    return missingConfig(providerId, checkedAt, "Add an API key in Settings > Provider config.");
  }
  try {
    const endpoint = resolveUrl(settings.apiBaseUrl, "https://api.deepseek.com/user/balance");
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...parseHeadersJson(settings.headersJson),
      },
    });
    if (!response.ok) {
      return failed(providerId, checkedAt, `DeepSeek balance request failed (${response.status}).`);
    }
    const json = (await response.json()) as {
      is_available?: unknown;
      balance_infos?: Array<{
        currency?: string;
        total_balance?: string | number;
        granted_balance?: string | number;
        topped_up_balance?: string | number;
      }>;
    };
    const balances = Array.isArray(json.balance_infos) ? json.balance_infos : [];
    const usd = balances.find((entry) => String(entry.currency).toUpperCase() === "USD");
    const balance = numberOrNull(usd?.total_balance) ?? numberOrNull(balances[0]?.total_balance);
    const grantedBalance =
      numberOrNull(usd?.granted_balance) ?? numberOrNull(balances[0]?.granted_balance);
    const toppedUpBalance =
      numberOrNull(usd?.topped_up_balance) ?? numberOrNull(balances[0]?.topped_up_balance);
    const snapshot: UsageSnapshot = {
      checkedAt,
      provider: providerId,
      primaryUsedPercent: null,
      primaryResetAfterSeconds: null,
      secondaryUsedPercent: null,
      secondaryResetAfterSeconds: null,
      creditsBalance: balance,
      creditsGranted: grantedBalance,
      creditsUsed: toppedUpBalance,
      raw: {
        source: "deepseek-api",
        available: json.is_available ?? null,
        balanceInfos: balances,
        grantedBalance,
        toppedUpBalance,
      },
    };
    return ok(providerId, checkedAt, "deepseek-api", snapshot);
  } catch {
    return failed(providerId, checkedAt, "DeepSeek balance request failed.");
  }
}

async function fetchClaudeCli(
  checkedAt: number,
  providerId: string,
  settings: ProviderConnectionSettings,
): Promise<ProviderUsageResult> {
  const cli = settings.cliPath || "claude";
  const output = await runCommand(cli, ["/usage"]);
  if (!output.ok) {
    return failed(
      providerId,
      checkedAt,
      "Unable to query Claude CLI. Ensure `claude` is installed and logged in.",
    );
  }
  const snapshot = parsePercentOutput(providerId, checkedAt, output.stdout + "\n" + output.stderr);
  if (!snapshot) {
    return failed(providerId, checkedAt, "Claude CLI output did not include parsable usage percentages.");
  }
  return ok(providerId, checkedAt, "claude-cli", snapshot);
}

async function fetchKiroCli(
  checkedAt: number,
  providerId: string,
  settings: ProviderConnectionSettings,
): Promise<ProviderUsageResult> {
  const cli = settings.cliPath || "kiro-cli";
  const output = await runCommand(cli, ["chat", "--no-interactive", "/usage"]);
  if (!output.ok) {
    return failed(
      providerId,
      checkedAt,
      "Unable to query Kiro CLI. Ensure `kiro-cli` is installed, launched, and logged in.",
    );
  }
  const snapshot = parsePercentOutput(providerId, checkedAt, output.stdout + "\n" + output.stderr);
  if (!snapshot) {
    return failed(providerId, checkedAt, "Kiro CLI output did not include parsable usage percentages.");
  }
  return ok(providerId, checkedAt, "kiro-cli", snapshot);
}

async function fetchGeminiCli(
  checkedAt: number,
  providerId: string,
  settings: ProviderConnectionSettings,
): Promise<ProviderUsageResult> {
  const cli = settings.cliPath || "gemini";
  const output = await runCommand(cli, ["/stats"]);
  if (!output.ok) {
    return failed(
      providerId,
      checkedAt,
      "Unable to query Gemini CLI. Ensure `gemini` is installed and authenticated.",
    );
  }
  const snapshot = parsePercentOutput(providerId, checkedAt, output.stdout + "\n" + output.stderr);
  if (!snapshot) {
    return failed(providerId, checkedAt, "Gemini CLI output did not include parsable usage percentages.");
  }
  return ok(providerId, checkedAt, "gemini-cli", snapshot);
}

async function runCommand(
  command: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    const known = error as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: known.stdout ?? "",
      stderr: known.stderr ?? known.message ?? "",
    };
  }
}

function parsePercentOutput(providerId: string, checkedAt: number, text: string): UsageSnapshot | null {
  const normalized = text.replace(/\u001b\[[0-9;]*m/g, " ");
  const matches = [...normalized.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)];
  if (matches.length === 0) {
    return null;
  }

  const first = numberOrNull(matches[0]?.[1]);
  const second = numberOrNull(matches[1]?.[1]);
  const firstUsed = first != null ? clamp(first, 0, 100) : null;
  const secondUsed = second != null ? clamp(second, 0, 100) : null;

  return {
    checkedAt,
    provider: providerId,
    primaryUsedPercent: firstUsed,
    primaryResetAfterSeconds: null,
    secondaryUsedPercent: secondUsed,
    secondaryResetAfterSeconds: null,
    raw: { source: "cli-parse", sample: normalized.slice(0, 2000) },
  };
}

function ok(
  providerId: string,
  checkedAt: number,
  source: string,
  snapshot: UsageSnapshot,
): ProviderUsageResult {
  return { providerId, checkedAt, source, snapshot, error: null, note: null };
}

function failed(providerId: string, checkedAt: number, error: string): ProviderUsageResult {
  return { providerId, checkedAt, source: "native", snapshot: null, error, note: null };
}

function missingConfig(providerId: string, checkedAt: number, note: string): ProviderUsageResult {
  return {
    providerId,
    checkedAt,
    source: "native",
    snapshot: null,
    error: `Missing configuration for '${providerId}'. ${note}`,
    note: null,
  };
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveUrl(override: string, fallback: string): string {
  return override.trim() || fallback;
}

function parseHeadersJson(raw: string): Record<string, string> {
  if (!raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }
    return headers;
  } catch {
    return {};
  }
}

function sumActivityUsage(items: OpenRouterActivityItem[]): number | null {
  if (items.length === 0) {
    return null;
  }
  let total = 0;
  let sawValue = false;
  for (const item of items) {
    const usage = numberOrNull(item.usage);
    if (usage != null) {
      total += usage;
      sawValue = true;
    }
  }
  return sawValue ? total : null;
}

function preferNonZero(...values: Array<number | null | undefined>): number | null {
  let fallback: number | null = null;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) {
      continue;
    }
    if (value > 0) {
      return value;
    }
    if (fallback == null) {
      fallback = value;
    }
  }
  return fallback;
}
