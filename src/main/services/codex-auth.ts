import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AuthStatus } from "../../../shared/types";

type AuthFilePayload = Record<string, unknown>;

export type CodexAuthResult =
  | {
      status: "ok";
      authStatus: AuthStatus;
      authMessage: string | null;
      codexHome: string;
      authPath: string;
      accessToken: string;
      refreshToken: string | null;
      expiresAtMs: number | null;
      tokenEndpoint: string | null;
      accountId: string | null;
      accountLabel: string | null;
      raw: AuthFilePayload;
    }
  | {
      status: "error";
      authStatus: Exclude<AuthStatus, "ok">;
      authMessage: string;
      codexHome: string;
      authPath: string;
    };

const PREFERRED_ACCESS_TOKEN_KEYS = ["access_token", "accessToken", "token", "id_token", "idToken"];
const REFRESH_TOKEN_KEYS = new Set(["refresh_token", "refreshToken"]);
const EXPIRES_AT_KEYS = new Set(["expires_at", "expiresAt", "expiry", "exp"]);
const EXPIRES_IN_KEYS = new Set(["expires_in", "expiresIn"]);
const TOKEN_ENDPOINT_KEYS = new Set([
  "token_endpoint",
  "tokenEndpoint",
  "refresh_endpoint",
  "refreshEndpoint",
  "oauth_token_endpoint",
]);
const ACCOUNT_ID_KEYS = new Set(["account_id", "accountId", "chatgpt_account_id", "chatgptAccountId"]);
const ACCOUNT_LABEL_KEYS = new Set(["email", "username", "account_label", "accountLabel"]);

export function resolveCodexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export async function loadCodexAuth(): Promise<CodexAuthResult> {
  const codexHome = resolveCodexHome();
  const authPath = path.join(codexHome, "auth.json");

  if (!fs.existsSync(authPath)) {
    return {
      status: "error",
      authStatus: "not_found",
      authMessage: "Codex auth not found. Run `codex login`, then refresh.",
      codexHome,
      authPath,
    };
  }

  let payload: AuthFilePayload;
  try {
    payload = JSON.parse(fs.readFileSync(authPath, "utf8")) as AuthFilePayload;
  } catch {
    return {
      status: "error",
      authStatus: "error",
      authMessage: "Codex auth file could not be parsed.",
      codexHome,
      authPath,
    };
  }

  const accessToken = findPreferredString(payload, PREFERRED_ACCESS_TOKEN_KEYS);
  const refreshToken = findFirstString(payload, REFRESH_TOKEN_KEYS);
  const tokenEndpoint = findFirstString(payload, TOKEN_ENDPOINT_KEYS);
  const accountId = findFirstString(payload, ACCOUNT_ID_KEYS);

  const jwtPayload = accessToken ? decodeJwtPayload(accessToken) : null;
  const expiresAtMs =
    normalizeExpiresAt(findFirstValue(payload, EXPIRES_AT_KEYS), findFirstValue(payload, EXPIRES_IN_KEYS)) ??
    getJwtExpiryMs(jwtPayload);

  const accountLabel =
    findFirstString(payload, ACCOUNT_LABEL_KEYS) ??
    getJwtAccountLabel(jwtPayload);

  if (!accessToken) {
    return {
      status: "error",
      authStatus: "error",
      authMessage: "Codex auth file does not contain an access token.",
      codexHome,
      authPath,
    };
  }

  const isExpired = expiresAtMs != null && expiresAtMs <= Date.now();
  if (isExpired) {
    const refreshed = refreshToken
      ? await tryRefreshAccessToken(refreshToken, tokenEndpoint, payload)
      : null;

    if (refreshed?.accessToken) {
      return {
        status: "ok",
        authStatus: "ok",
        authMessage: null,
        codexHome,
        authPath,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? refreshToken ?? null,
        expiresAtMs: refreshed.expiresAtMs,
        tokenEndpoint: refreshed.tokenEndpoint ?? tokenEndpoint ?? null,
        accountId: refreshed.accountId ?? accountId ?? null,
        accountLabel: refreshed.accountLabel ?? accountLabel ?? null,
        raw: payload,
      };
    }

    return {
      status: "error",
      authStatus: "expired",
      authMessage: "Token expired. Open Codex or run `codex login` to refresh.",
      codexHome,
      authPath,
    };
  }

  return {
    status: "ok",
    authStatus: "ok",
    authMessage: null,
    codexHome,
    authPath,
    accessToken,
    refreshToken: refreshToken ?? null,
    expiresAtMs,
    tokenEndpoint: tokenEndpoint ?? null,
    accountId: accountId ?? null,
    accountLabel: accountLabel ?? null,
    raw: payload,
  };
}

type RefreshedToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresAtMs: number | null;
  tokenEndpoint: string | null;
  accountId: string | null;
  accountLabel: string | null;
};

async function tryRefreshAccessToken(
  refreshToken: string,
  tokenEndpoint: string | null,
  payload: AuthFilePayload,
): Promise<RefreshedToken | null> {
  const endpoint = tokenEndpoint ?? process.env.CODEX_AUTH_REFRESH_URL ?? null;
  if (!endpoint) {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as AuthFilePayload;
    const nextAccessToken = findPreferredString(json, PREFERRED_ACCESS_TOKEN_KEYS);
    if (!nextAccessToken) {
      return null;
    }

    const jwtPayload = decodeJwtPayload(nextAccessToken);
    return {
      accessToken: nextAccessToken,
      refreshToken: findFirstString(json, REFRESH_TOKEN_KEYS) ?? refreshToken,
      expiresAtMs:
        normalizeExpiresAt(findFirstValue(json, EXPIRES_AT_KEYS), findFirstValue(json, EXPIRES_IN_KEYS)) ??
        getJwtExpiryMs(jwtPayload),
      tokenEndpoint: findFirstString(json, TOKEN_ENDPOINT_KEYS) ?? endpoint,
      accountId: findFirstString(json, ACCOUNT_ID_KEYS) ?? findFirstString(payload, ACCOUNT_ID_KEYS),
      accountLabel:
        findFirstString(json, ACCOUNT_LABEL_KEYS) ??
        getJwtAccountLabel(jwtPayload) ??
        findFirstString(payload, ACCOUNT_LABEL_KEYS),
    };
  } catch {
    return null;
  }
}

function findFirstValue(input: unknown, keySet: Set<string>, depth = 0): unknown {
  if (depth > 6 || input == null || typeof input !== "object") {
    return null;
  }
  if (Array.isArray(input)) {
    for (const value of input) {
      const nested = findFirstValue(value, keySet, depth + 1);
      if (nested != null) {
        return nested;
      }
    }
    return null;
  }

  const object = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(object)) {
    if (keySet.has(key) && value != null) {
      return value;
    }
  }
  for (const value of Object.values(object)) {
    const nested = findFirstValue(value, keySet, depth + 1);
    if (nested != null) {
      return nested;
    }
  }
  return null;
}

function findFirstString(input: unknown, keySet: Set<string>): string | null {
  const found = findFirstValue(input, keySet);
  return typeof found === "string" && found.trim() ? found : null;
}

function findPreferredString(input: unknown, keys: string[]): string | null {
  for (const key of keys) {
    const found = findFirstValue(input, new Set([key]));
    if (typeof found === "string" && found.trim()) {
      return found;
    }
  }
  return null;
}

function normalizeExpiresAt(expiresAtValue: unknown, expiresInValue: unknown): number | null {
  const expiresAt = toNumber(expiresAtValue);
  if (expiresAt != null) {
    return expiresAt > 1_000_000_000_000 ? expiresAt : expiresAt * 1000;
  }

  const expiresIn = toNumber(expiresInValue);
  if (expiresIn != null) {
    return Date.now() + expiresIn * 1000;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const payload = Buffer.from(base64UrlDecode(parts[1]), "base64").toString("utf8");
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return `${normalized}${padding}`;
}

function getJwtExpiryMs(payload: Record<string, unknown> | null): number | null {
  if (!payload) {
    return null;
  }
  const exp = toNumber(payload.exp);
  return exp != null ? exp * 1000 : null;
}

function getJwtAccountLabel(payload: Record<string, unknown> | null): string | null {
  if (!payload) {
    return null;
  }

  const direct =
    (typeof payload.email === "string" && payload.email) ||
    (typeof payload.sub === "string" && payload.sub) ||
    null;
  if (direct) {
    return direct;
  }

  const nested = payload["https://api.openai.com/auth"];
  if (nested && typeof nested === "object") {
    const authObj = nested as Record<string, unknown>;
    if (typeof authObj.chatgpt_user_id === "string" && authObj.chatgpt_user_id) {
      return authObj.chatgpt_user_id;
    }
  }
  return null;
}
