import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { AuthStatus, ProviderMode, UsageSnapshot } from "../../../shared/types";
import { loadCodexAuth, resolveCodexHome, type CodexAuthResult } from "./codex-auth";

const execFileAsync = promisify(execFile);

type UsagePollResult = {
  snapshot: UsageSnapshot | null;
  providerMode: ProviderMode;
  authStatus: AuthStatus;
  authMessage: string | null;
  errorMessage: string | null;
};

type CandidateResponse = {
  endpoint: string;
  status: number;
  source: "usage-endpoint" | "header-fallback" | "sse-fallback";
  payload?: unknown;
  bodyText?: string;
  headers: Record<string, string>;
};

type AppServerQueryResult = {
  account: Record<string, unknown> | null;
  rateLimits: Record<string, unknown> | null;
  tokenExpired: boolean;
  authRequired: boolean;
  errorMessage: string | null;
};

const HEADER_KEYS = {
  primaryUsedPercent: "x-codex-primary-used-percent",
  secondaryUsedPercent: "x-codex-secondary-used-percent",
  primaryWindowMinutes: "x-codex-primary-window-minutes",
  secondaryWindowMinutes: "x-codex-secondary-window-minutes",
  primaryResetAfterSeconds: "x-codex-primary-reset-after-seconds",
  secondaryResetAfterSeconds: "x-codex-secondary-reset-after-seconds",
  primaryResetsAt: "x-codex-primary-resets-at",
  secondaryResetsAt: "x-codex-secondary-resets-at",
  planType: "x-codex-plan-type",
  creditsBalance: "x-codex-credits-balance",
  creditsGranted: "x-codex-credits-granted",
  creditsUsed: "x-codex-credits-used",
};

export class CodexUsageService {
  async pollUsage(): Promise<UsagePollResult> {
    const fromAppServer = await this.fetchFromAppServer();
    if (fromAppServer.snapshot) {
      return fromAppServer;
    }
    if (fromAppServer.authStatus === "expired") {
      return fromAppServer;
    }

    const fromRollout = await this.fetchFromRolloutLogs();
    if (fromRollout) {
      return {
        snapshot: fromRollout,
        providerMode: "rollout",
        authStatus: "ok",
        authMessage: "Using local rollout logs (latest available snapshot).",
        errorMessage: null,
      };
    }

    const enableHttpFallback = process.env.CODEX_PULSE_ENABLE_HTTP_FALLBACK === "1";
    const enableCliUsageFallback = process.env.CODEX_PULSE_ENABLE_CLI_USAGE === "1";
    const auth = await loadCodexAuth();

    if (enableHttpFallback && auth.status === "ok") {
      const fromEndpoint = await this.fetchFromEndpoints(auth);
      if (fromEndpoint.snapshot) {
        return {
          snapshot: fromEndpoint.snapshot,
          providerMode: "endpoint",
          authStatus: "ok",
          authMessage: "Using HTTP endpoint fallback.",
          errorMessage: null,
        };
      }

      if (fromEndpoint.tokenExpired) {
        return {
          snapshot: null,
          providerMode: "none",
          authStatus: "expired",
          authMessage: "Token expired. Open Codex or run `codex login` to refresh.",
          errorMessage: "Usage endpoint authentication token is expired.",
        };
      }
    }

    if (enableCliUsageFallback) {
      const fromCli = await this.fetchFromCli(auth);
      if (fromCli.snapshot) {
        return fromCli;
      }
    }

    await this.fetchFromBrowserCookieProviderPlaceholder();

    if (auth.status === "error") {
      const keychainMessage =
        auth.authStatus === "not_found" && (await hasCodexBinary())
          ? "Codex credentials are stored in OS keychain. File-based auth was not found. CLI fallback required."
          : auth.authMessage;

      return {
        snapshot: null,
        providerMode: "none",
        authStatus:
          auth.authStatus === "not_found" && keychainMessage ? "keychain_only" : auth.authStatus,
        authMessage: keychainMessage,
        errorMessage: fromAppServer.errorMessage ?? "No usage sources returned data.",
      };
    }

    return {
      snapshot: null,
      providerMode: "none",
      authStatus: fromAppServer.authStatus,
      authMessage: fromAppServer.authMessage,
      errorMessage: fromAppServer.errorMessage ?? "No usage source returned data.",
    };
  }

  private async fetchFromAppServer(): Promise<UsagePollResult> {
    if (!(await hasCodexBinary())) {
      return {
        snapshot: null,
        providerMode: "none",
        authStatus: "not_found",
        authMessage: null,
        errorMessage: "Codex CLI not found for app-server provider.",
      };
    }

    const query = await queryAppServerRateLimits(12_000);
    if (query.tokenExpired) {
      return {
        snapshot: null,
        providerMode: "none",
        authStatus: "expired",
        authMessage: "Token expired. Open Codex or run `codex login` to refresh.",
        errorMessage: "App-server authentication token appears expired.",
      };
    }

    if (!query.rateLimits) {
      return {
        snapshot: null,
        providerMode: "none",
        authStatus: query.authRequired ? "not_found" : "error",
        authMessage: query.authRequired
          ? "Codex auth not found. Run `codex login`, then refresh."
          : null,
        errorMessage: query.errorMessage ?? "App-server did not return rate limits.",
      };
    }

    const checkedAt = Date.now();
    const account = query.account ?? {};
    const rateLimits = query.rateLimits;
    const primary = toObject(rateLimits.primary) ?? {};
    const secondary = toObject(rateLimits.secondary) ?? {};
    const credits = toObject(rateLimits.credits) ?? {};

    const primaryResetAfterSeconds =
      pickNumber(
        [primary.resetsInSeconds, primary.reset_after_seconds, primary.resetAfterSeconds],
        null,
      ) ?? secondsUntilEpoch(primary.resetsAt);
    const secondaryResetAfterSeconds =
      pickNumber(
        [secondary.resetsInSeconds, secondary.reset_after_seconds, secondary.resetAfterSeconds],
        null,
      ) ?? secondsUntilEpoch(secondary.resetsAt);

    const primaryUsedPercent = pickNumber(
      [primary.usedPercent, primary.used_percent, rateLimits.primary_used_percent],
      null,
    );
    const secondaryUsedPercent = pickNumber(
      [secondary.usedPercent, secondary.used_percent, rateLimits.secondary_used_percent],
      null,
    );

    if (primaryUsedPercent == null && secondaryUsedPercent == null) {
      return {
        snapshot: null,
        providerMode: "none",
        authStatus: "error",
        authMessage: null,
        errorMessage: "App-server returned rate limits without usage percentages.",
      };
    }

    const snapshot: UsageSnapshot = {
      checkedAt,
      provider: "codex",
      accountLabel:
        pickString([account.email, account.userId, account.chatgpt_user_id]) ?? undefined,
      planType:
        pickString([account.planType, rateLimits.planType, rateLimits.plan_type]) ?? undefined,
      primaryUsedPercent,
      primaryResetAfterSeconds,
      primaryWindowMinutes: pickNumber(
        [primary.windowDurationMins, primary.window_minutes, primary.windowMinutes],
        null,
      ),
      secondaryUsedPercent,
      secondaryResetAfterSeconds,
      secondaryWindowMinutes: pickNumber(
        [secondary.windowDurationMins, secondary.window_minutes, secondary.windowMinutes],
        null,
      ),
      creditsBalance: pickNumber([credits.balance, credits.remaining], null),
      creditsGranted: pickNumber([credits.granted], null),
      creditsUsed: pickNumber([credits.used], null),
      raw: {
        source: "codex-app-server",
        account: redactSecrets(account),
        rateLimits: redactSecrets(rateLimits),
      },
    };

    return {
      snapshot,
      providerMode: "app_server",
      authStatus: "ok",
      authMessage: null,
      errorMessage: null,
    };
  }

  private async fetchFromRolloutLogs(): Promise<UsageSnapshot | null> {
    const sessionsDir = path.join(resolveCodexHome(), "sessions");
    const candidates = findLatestRolloutFiles(sessionsDir, 30);

    for (const filePath of candidates) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i].trim();
        if (!line) {
          continue;
        }
        const parsed = safeJsonParse(line);
        const event = toObject(parsed);
        if (!event) {
          continue;
        }

        const payload = toObject(event.payload);
        if (!payload || payload.type !== "token_count") {
          continue;
        }

        const rateLimits = toObject(payload.rate_limits) ?? toObject(payload.rateLimits);
        if (!rateLimits) {
          continue;
        }

        const primary = toObject(rateLimits.primary) ?? {};
        const secondary = toObject(rateLimits.secondary) ?? {};
        const credits = toObject(rateLimits.credits) ?? toObject(payload.credits) ?? {};

        const primaryUsedPercent = pickNumber([primary.used_percent, primary.usedPercent], null);
        const secondaryUsedPercent = pickNumber(
          [secondary.used_percent, secondary.usedPercent],
          null,
        );
        if (primaryUsedPercent == null && secondaryUsedPercent == null) {
          continue;
        }

        const primaryResetAfterSeconds =
          pickNumber(
            [
              primary.resets_in_seconds,
              primary.resetsInSeconds,
              primary.reset_after_seconds,
              primary.resetAfterSeconds,
            ],
            null,
          ) ?? secondsUntil(primary.resetsAt) ?? secondsUntil(primary.resets_at);
        const secondaryResetAfterSeconds =
          pickNumber(
            [
              secondary.resets_in_seconds,
              secondary.resetsInSeconds,
              secondary.reset_after_seconds,
              secondary.resetAfterSeconds,
            ],
            null,
          ) ?? secondsUntil(secondary.resetsAt) ?? secondsUntil(secondary.resets_at);

        const timestamp = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : NaN;
        const checkedAt = Number.isFinite(timestamp) ? timestamp : Date.now();

        return {
          checkedAt,
          provider: "codex",
          planType:
            pickString([rateLimits.plan_type, rateLimits.planType, payload.plan_type]) ??
            undefined,
          primaryUsedPercent,
          primaryResetAfterSeconds,
          primaryWindowMinutes: pickNumber(
            [primary.window_minutes, primary.windowDurationMins, primary.windowMinutes],
            null,
          ),
          secondaryUsedPercent,
          secondaryResetAfterSeconds,
          secondaryWindowMinutes: pickNumber(
            [secondary.window_minutes, secondary.windowDurationMins, secondary.windowMinutes],
            null,
          ),
          creditsBalance: pickNumber([credits.balance, credits.remaining], null),
          creditsGranted: pickNumber([credits.granted], null),
          creditsUsed: pickNumber([credits.used], null),
          raw: {
            source: "rollout-jsonl",
            file: filePath,
            payload: redactSecrets(payload),
          },
        };
      }
    }
    return null;
  }

  private async fetchFromEndpoints(auth: Extract<CodexAuthResult, { status: "ok" }>) {
    const checkedAt = Date.now();
    const candidates = getEndpointCandidates();
    let tokenExpired = false;
    for (const endpoint of candidates) {
      const response = await this.requestEndpoint(endpoint, auth.accessToken, "usage-endpoint");
      if (!response) {
        continue;
      }
      tokenExpired = tokenExpired || responseHasExpiredTokenSignal(response);
      const snapshot = normalizeSnapshot(response, checkedAt, auth.accountLabel);
      if (snapshot) {
        return { snapshot, tokenExpired };
      }
    }

    for (const endpoint of getHeaderFallbackCandidates()) {
      const response = await this.requestEndpoint(endpoint, auth.accessToken, "header-fallback");
      if (!response) {
        continue;
      }
      tokenExpired = tokenExpired || responseHasExpiredTokenSignal(response);
      const snapshot = normalizeSnapshot(response, checkedAt, auth.accountLabel);
      if (snapshot) {
        return { snapshot, tokenExpired };
      }
    }

    for (const endpoint of getSseCandidates()) {
      const response = await this.requestSseEndpoint(endpoint, auth.accessToken);
      if (!response) {
        continue;
      }
      tokenExpired = tokenExpired || responseHasExpiredTokenSignal(response);
      const snapshot = normalizeSnapshot(response, checkedAt, auth.accountLabel);
      if (snapshot) {
        return { snapshot, tokenExpired };
      }
    }

    return { snapshot: null as UsageSnapshot | null, tokenExpired };
  }

  private async requestEndpoint(
    endpoint: string,
    accessToken: string,
    source: CandidateResponse["source"],
  ): Promise<CandidateResponse | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json, text/event-stream;q=0.8",
          "user-agent": "codex-pulse",
        },
        signal: controller.signal,
      });

      const headers = lowerCaseHeaders(response.headers);
      const contentType = headers["content-type"] ?? "";
      let payload: unknown = undefined;
      let bodyText: string | undefined = undefined;
      if (contentType.includes("application/json")) {
        payload = await response.json();
      } else {
        bodyText = await response.text();
      }

      return {
        endpoint,
        status: response.status,
        source,
        payload,
        bodyText,
        headers,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestSseEndpoint(
    endpoint: string,
    accessToken: string,
  ): Promise<CandidateResponse | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "text/event-stream",
          "cache-control": "no-cache",
          "user-agent": "codex-pulse",
        },
        signal: controller.signal,
      });

      const headers = lowerCaseHeaders(response.headers);
      if (!response.body || !response.ok) {
        let bodyText: string | undefined = undefined;
        try {
          bodyText = await response.text();
        } catch {
          // ignore
        }
        return {
          endpoint,
          status: response.status,
          source: "sse-fallback",
          headers,
          bodyText,
        };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let firstEventPayload: unknown = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const eventBlock of events) {
          const parsed = parseSseBlock(eventBlock);
          if (parsed.event === "codex.rate_limits" && parsed.data) {
            firstEventPayload = safeJsonParse(parsed.data);
            break;
          }
        }
        if (firstEventPayload) {
          break;
        }
      }

      return {
        endpoint,
        status: response.status,
        source: "sse-fallback",
        headers,
        payload: firstEventPayload,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchFromCli(auth: CodexAuthResult): Promise<UsagePollResult> {
    if (!(await hasCodexBinary())) {
      return {
        snapshot: null,
        providerMode: "none",
        authStatus: auth.status === "error" ? auth.authStatus : "ok",
        authMessage: auth.status === "error" ? auth.authMessage : null,
        errorMessage: "Codex CLI not found for fallback.",
      };
    }

    try {
      const stdout = await runCodexCommand(["usage", "--json"], 12_000);
      const parsed = parseJsonOutput(stdout);
      const checkedAt = Date.now();
      const snapshot = normalizeSnapshot(
        {
          endpoint: "codex usage --json",
          source: "usage-endpoint",
          status: 200,
          payload: parsed,
          headers: {},
        },
        checkedAt,
        auth.status === "ok" ? auth.accountLabel : null,
      );

      if (!snapshot) {
        return {
          snapshot: null,
          providerMode: "none",
          authStatus: auth.status === "error" ? auth.authStatus : "ok",
          authMessage: auth.status === "error" ? auth.authMessage : null,
          errorMessage: "CLI output did not contain expected usage fields.",
        };
      }

      return {
        snapshot,
        providerMode: "cli",
        authStatus:
          auth.status === "error" && auth.authStatus === "not_found" ? "keychain_only" : "ok",
        authMessage:
          auth.status === "error" && auth.authStatus === "not_found"
            ? "Codex credentials are stored in OS keychain. File-based auth was not found. CLI fallback in use."
            : null,
        errorMessage: null,
      };
    } catch {
      return {
        snapshot: null,
        providerMode: "none",
        authStatus: auth.status === "error" ? auth.authStatus : "ok",
        authMessage:
          auth.status === "error"
            ? auth.authMessage
            : "Usage endpoint failed and `codex usage --json` is not available.",
        errorMessage: "CLI fallback failed.",
      };
    }
  }

  // Reserved for v1+ browser-cookie provider integration.
  private async fetchFromBrowserCookieProviderPlaceholder(): Promise<null> {
    return null;
  }
}

function getEndpointCandidates(): string[] {
  const override = process.env.CODEX_USAGE_ENDPOINT;
  return compactUnique([
    override ?? null,
    "https://chatgpt.com/backend-api/wham/usage",
    "https://chatgpt.com/api/codex/usage",
    "https://chatgpt.com/backend-api/codex/usage",
    "https://chat.openai.com/api/codex/usage",
    "https://chat.openai.com/backend-api/codex/usage",
  ]);
}

function getHeaderFallbackCandidates(): string[] {
  return compactUnique([
    "https://chatgpt.com/api/codex/status",
    "https://chatgpt.com/backend-api/models",
    "https://chat.openai.com/api/codex/status",
    "https://chat.openai.com/backend-api/models",
  ]);
}

function getSseCandidates(): string[] {
  return compactUnique([
    "https://chatgpt.com/api/codex/events",
    "https://chatgpt.com/backend-api/codex/events",
    "https://chat.openai.com/api/codex/events",
  ]);
}

function compactUnique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function findLatestRolloutFiles(rootDir: string, limit: number): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const stack: string[] = [rootDir];
  const files: Array<{ path: string; mtimeMs: number }> = [];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) {
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
      } catch {
        // ignore
      }
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, limit).map((item) => item.path);
}

async function hasCodexBinary(): Promise<boolean> {
  try {
    await runCodexCommand(["--version"], 8_000);
    return true;
  } catch {
    return false;
  }
}

async function runCodexCommand(args: string[], timeout: number): Promise<string> {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("cmd.exe", ["/d", "/s", "/c", "codex", ...args], {
      timeout,
      windowsHide: true,
    });
    return stdout;
  }
  const { stdout } = await execFileAsync("codex", args, { timeout, windowsHide: true });
  return stdout;
}

async function queryAppServerRateLimits(timeoutMs: number): Promise<AppServerQueryResult> {
  const command =
    process.platform === "win32"
      ? {
          file: "cmd.exe",
          args: ["/d", "/s", "/c", "codex", "app-server"],
        }
      : {
          file: "codex",
          args: ["app-server"],
        };

  const child = spawn(command.file, command.args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let account: Record<string, unknown> | null = null;
  let rateLimits: Record<string, unknown> | null = null;
  let tokenExpired = false;
  let authRequired = false;
  let errorMessage: string | null = null;
  let settled = false;

  return await new Promise((resolve) => {
    const finalize = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      removeListeners();
      if (!child.killed) {
        child.kill();
      }
      resolve({
        account,
        rateLimits,
        tokenExpired,
        authRequired,
        errorMessage,
      });
    };

    const onLine = (line: string) => {
      const parsed = safeJsonParse(line);
      if (!parsed || typeof parsed !== "object") {
        if (/token_expired|expired/i.test(line)) {
          tokenExpired = true;
        }
        return;
      }

      const object = parsed as Record<string, unknown>;
      if (containsExpiredSignal(object)) {
        tokenExpired = true;
      }
      if (containsAuthRequiredSignal(object)) {
        authRequired = true;
      }

      if (typeof object.id === "number") {
        if (object.id === 2) {
          const result = toObject(object.result);
          const nextAccount = toObject(result?.account);
          if (nextAccount) {
            account = nextAccount;
          }
        } else if (object.id === 3) {
          const result = toObject(object.result);
          const direct = toObject(result?.rateLimits) ?? toObject(result?.rate_limits);
          if (direct) {
            rateLimits = direct;
            finalize();
            return;
          }
          const error = toObject(object.error);
          if (error) {
            errorMessage = pickString([error.message, error.code]) ?? "app-server rateLimits read failed";
            finalize();
            return;
          }
        }
      }

      if (object.method === "account/rateLimits/updated") {
        const params = toObject(object.params);
        const updated = toObject(params?.rateLimits) ?? toObject(params?.rate_limits);
        if (updated) {
          rateLimits = updated;
          finalize();
        }
      }
    };

    const removeListeners = () => {
      child.stdout.removeAllListeners("data");
      child.stderr.removeAllListeners("data");
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      child.removeAllListeners("spawn");
    };

    wireLineHandler(child.stdout, onLine);
    wireLineHandler(child.stderr, onLine);

    child.on("error", (error) => {
      errorMessage = `Failed to start app-server: ${error.message}`;
      finalize();
    });
    child.on("exit", () => {
      finalize();
    });
    child.on("spawn", () => {
      const init = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "codex-pulse",
            version: "0.1.0",
          },
        },
      };
      const initialized = {
        jsonrpc: "2.0",
        method: "initialized",
        params: {},
      };
      const accountRead = {
        jsonrpc: "2.0",
        id: 2,
        method: "account/read",
        params: {
          refreshToken: true,
        },
      };
      const rateLimitsRead = {
        jsonrpc: "2.0",
        id: 3,
        method: "account/rateLimits/read",
        params: {},
      };

      child.stdin.write(`${JSON.stringify(init)}\n`);
      child.stdin.write(`${JSON.stringify(initialized)}\n`);
      child.stdin.write(`${JSON.stringify(accountRead)}\n`);
      child.stdin.write(`${JSON.stringify(rateLimitsRead)}\n`);
    });

    const timer = setTimeout(() => {
      if (!rateLimits && !errorMessage) {
        errorMessage = "Timed out waiting for app-server rate limits.";
      }
      finalize();
    }, timeoutMs);
  });
}

function wireLineHandler(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
) {
  stream.setEncoding("utf8");
  let buffer = "";
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      onLine(line);
    }
  });
}

function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  const direct = safeJsonParse(trimmed);
  if (direct != null) {
    return direct;
  }

  const start = trimmed.lastIndexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return safeJsonParse(trimmed.slice(start, end + 1));
  }
  return null;
}

function normalizeSnapshot(
  response: CandidateResponse,
  checkedAt: number,
  accountLabel: string | null,
): UsageSnapshot | null {
  const fromPayload = response.payload
    ? snapshotFromPayload(response.payload, checkedAt, accountLabel)
    : null;
  if (fromPayload) {
    return {
      ...fromPayload,
      raw: {
        endpoint: response.endpoint,
        source: response.source,
        status: response.status,
        headers: response.headers,
        payload: redactSecrets(response.payload),
      },
    };
  }

  const fromHeaders = snapshotFromHeaders(response.headers, checkedAt, accountLabel);
  if (fromHeaders) {
    return {
      ...fromHeaders,
      raw: {
        endpoint: response.endpoint,
        source: response.source,
        status: response.status,
        headers: response.headers,
        payload: redactSecrets(response.payload),
      },
    };
  }
  return null;
}

function snapshotFromPayload(
  payload: unknown,
  checkedAt: number,
  accountLabel: string | null,
): UsageSnapshot | null {
  const root = toObject(payload);
  if (!root) {
    return null;
  }

  const rateLimits = toObject(root.rate_limits) ?? toObject(root.rateLimits) ?? root;
  const primary = toObject(rateLimits.primary) ?? toObject(root.primary) ?? null;
  const secondary = toObject(rateLimits.secondary) ?? toObject(root.secondary) ?? null;
  const credits = toObject(rateLimits.credits) ?? toObject(root.credits) ?? null;

  const primaryUsedPercent = pickNumber(
    [
      primary?.used_percent,
      primary?.usedPercent,
      rateLimits.primary_used_percent,
      root.primary_used_percent,
      root.primaryUsedPercent,
    ],
    null,
  );
  const secondaryUsedPercent = pickNumber(
    [
      secondary?.used_percent,
      secondary?.usedPercent,
      rateLimits.secondary_used_percent,
      root.secondary_used_percent,
      root.secondaryUsedPercent,
    ],
    null,
  );

  const primaryWindowMinutes = pickNumber(
    [
      primary?.window_minutes,
      primary?.windowMinutes,
      primary?.windowDurationMins,
      rateLimits.primary_window_minutes,
    ],
    null,
  );
  const secondaryWindowMinutes = pickNumber(
    [
      secondary?.window_minutes,
      secondary?.windowMinutes,
      secondary?.windowDurationMins,
      rateLimits.secondary_window_minutes,
    ],
    null,
  );

  const primaryResetAfterSeconds = pickNumber(
    [
      primary?.reset_after_seconds,
      primary?.resetAfterSeconds,
      primary?.resetsInSeconds,
      rateLimits.primary_reset_after_seconds,
      root.primary_reset_after_seconds,
      secondsUntil(primary?.resets_at),
      secondsUntil(primary?.resetsAt),
    ],
    null,
  );
  const secondaryResetAfterSeconds = pickNumber(
    [
      secondary?.reset_after_seconds,
      secondary?.resetAfterSeconds,
      secondary?.resetsInSeconds,
      rateLimits.secondary_reset_after_seconds,
      root.secondary_reset_after_seconds,
      secondsUntil(secondary?.resets_at),
      secondsUntil(secondary?.resetsAt),
    ],
    null,
  );

  if (primaryUsedPercent == null && secondaryUsedPercent == null) {
    return null;
  }

  return {
    checkedAt,
    provider: "codex",
    accountLabel: accountLabel ?? undefined,
    planType:
      pickString([rateLimits.plan_type, rateLimits.planType, root.plan_type, root.planType]) ??
      undefined,
    primaryUsedPercent,
    primaryResetAfterSeconds,
    primaryWindowMinutes,
    secondaryUsedPercent,
    secondaryResetAfterSeconds,
    secondaryWindowMinutes,
    creditsBalance: pickNumber([credits?.balance, credits?.remaining, root.credits_balance], null),
    creditsGranted: pickNumber([credits?.granted, root.credits_granted], null),
    creditsUsed: pickNumber([credits?.used, root.credits_used], null),
    raw: payload,
  };
}

function snapshotFromHeaders(
  headers: Record<string, string>,
  checkedAt: number,
  accountLabel: string | null,
): UsageSnapshot | null {
  const primaryUsedPercent = toNumber(headers[HEADER_KEYS.primaryUsedPercent]);
  const secondaryUsedPercent = toNumber(headers[HEADER_KEYS.secondaryUsedPercent]);
  if (primaryUsedPercent == null && secondaryUsedPercent == null) {
    return null;
  }

  const primaryResetAfterSeconds =
    toNumber(headers[HEADER_KEYS.primaryResetAfterSeconds]) ??
    secondsUntil(headers[HEADER_KEYS.primaryResetsAt]);
  const secondaryResetAfterSeconds =
    toNumber(headers[HEADER_KEYS.secondaryResetAfterSeconds]) ??
    secondsUntil(headers[HEADER_KEYS.secondaryResetsAt]);

  return {
    checkedAt,
    provider: "codex",
    accountLabel: accountLabel ?? undefined,
    planType: headers[HEADER_KEYS.planType] || undefined,
    primaryUsedPercent,
    primaryResetAfterSeconds,
    primaryWindowMinutes: toNumber(headers[HEADER_KEYS.primaryWindowMinutes]),
    secondaryUsedPercent,
    secondaryResetAfterSeconds,
    secondaryWindowMinutes: toNumber(headers[HEADER_KEYS.secondaryWindowMinutes]),
    creditsBalance: toNumber(headers[HEADER_KEYS.creditsBalance]),
    creditsGranted: toNumber(headers[HEADER_KEYS.creditsGranted]),
    creditsUsed: toNumber(headers[HEADER_KEYS.creditsUsed]),
  };
}

function lowerCaseHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key.toLowerCase()] = value;
  });
  return output;
}

function parseSseBlock(block: string): { event: string | null; data: string | null } {
  const lines = block.split("\n");
  let event: string | null = null;
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trim());
    }
  }
  return {
    event,
    data: data.length ? data.join("\n") : null,
  };
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function responseHasExpiredTokenSignal(response: CandidateResponse): boolean {
  if (response.status !== 401) {
    return false;
  }
  if (containsExpiredSignal(response.payload)) {
    return true;
  }
  if (response.bodyText && /token_expired|expired|unauthorized/i.test(response.bodyText)) {
    return true;
  }
  return false;
}

function containsExpiredSignal(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  if (typeof value === "string") {
    return /token_expired|expired|unauthorized/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsExpiredSignal(item));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) =>
      containsExpiredSignal(item),
    );
  }
  return false;
}

function containsAuthRequiredSignal(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  if (typeof value === "string") {
    return /requires openai auth|login required|not authenticated/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsAuthRequiredSignal(item));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) =>
      containsAuthRequiredSignal(item),
    );
  }
  return false;
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

function pickNumber(values: unknown[], fallback: number | null): number | null {
  for (const value of values) {
    const numeric = toNumber(value);
    if (numeric != null) {
      return numeric;
    }
  }
  return fallback;
}

function pickString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function secondsUntil(value: unknown): number | null {
  const epoch = toNumber(value);
  if (epoch == null) {
    return null;
  }
  const epochMs = epoch > 1_000_000_000_000 ? epoch : epoch * 1000;
  const delta = Math.floor((epochMs - Date.now()) / 1000);
  return delta >= 0 ? delta : 0;
}

function secondsUntilEpoch(value: unknown): number | null {
  const epoch = toNumber(value);
  if (epoch == null) {
    return null;
  }
  const delta = Math.floor(epoch - Date.now() / 1000);
  return delta >= 0 ? delta : 0;
}

export function codexSessionPathHint(): string {
  return `${resolveCodexHome()}${process.platform === "win32" ? "\\" : "/"}sessions`;
}

function redactSecrets(value: unknown): unknown {
  if (value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("token") ||
      lower.includes("authorization") ||
      lower.includes("cookie") ||
      lower.includes("secret")
    ) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = redactSecrets(nested);
    }
  }
  return output;
}
