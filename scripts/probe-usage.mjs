#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const requestedEndpoint = readArgValue(argv, "--endpoint");
const timeoutMs = Number(readArgValue(argv, "--timeout-ms") ?? "10000");

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const authPath = path.join(codexHome, "auth.json");

console.log(`Codex home: ${codexHome}`);
console.log(`Auth path: ${authPath}`);

let accessToken = null;
if (fs.existsSync(authPath)) {
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    accessToken = findFirstString(auth, new Set(["access_token", "accessToken", "id_token", "token"]));
    console.log(`Auth file: found (${accessToken ? "token present" : "token missing"})`);
  } catch (error) {
    console.log(`Auth file: parse error (${error.message})`);
  }
} else {
  console.log("Auth file: not found");
}

if (!accessToken) {
  console.log("\nNo usable token from auth.json. Trying CLI fallback only.");
  probeCli();
  process.exit(1);
}

const endpoints = unique([
  requestedEndpoint || null,
  process.env.CODEX_USAGE_ENDPOINT || null,
  "https://chatgpt.com/api/codex/usage",
  "https://chatgpt.com/backend-api/codex/usage",
  "https://chat.openai.com/api/codex/usage",
  "https://chat.openai.com/backend-api/codex/usage",
  "https://chatgpt.com/api/codex/status",
  "https://chat.openai.com/api/codex/status",
]);

for (const endpoint of endpoints) {
  await probeEndpoint(endpoint, accessToken, timeoutMs);
}

probeCli();

async function probeEndpoint(endpoint, token, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  console.log(`\n=== ${endpoint} ===`);
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream;q=0.8",
        "user-agent": "codex-pulse-probe",
      },
      signal: controller.signal,
    });

    console.log(`status: ${response.status} ${response.statusText}`);
    console.log(`content-type: ${response.headers.get("content-type") || "(none)"}`);

    const codexHeaders = [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith("x-codex-")) {
        codexHeaders.push([key, value]);
      }
    });
    if (codexHeaders.length) {
      console.log("x-codex-* headers:");
      for (const [key, value] of codexHeaders) {
        console.log(`  ${key}: ${value}`);
      }
    } else {
      console.log("x-codex-* headers: none");
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
      const json = await response.json();
      printJsonSummary(json);
    } else if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 25);
      console.log(`sse preview lines (${lines.length}):`);
      for (const line of lines) {
        console.log(`  ${line.slice(0, 200)}`);
      }
    } else {
      const text = await response.text();
      console.log(`body preview: ${text.slice(0, 300).replace(/\s+/g, " ")}`);
    }
  } catch (error) {
    console.log(`request error: ${error.name}: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function probeCli() {
  console.log("\n=== codex usage --json ===");
  try {
    const out = runCodexSync(["usage", "--json"], 12000);
    const trimmed = out.trim();
    console.log(trimmed ? trimmed.slice(0, 800) : "(empty output)");
  } catch (error) {
    const stderr = (error.stderr || "").toString().trim();
    if (stderr) {
      console.log(stderr.slice(0, 800));
    } else {
      console.log(`${error.name}: ${error.message}`);
    }
  }
}

function runCodexSync(args, timeout) {
  if (process.platform === "win32") {
    return execFileSync("cmd.exe", ["/d", "/s", "/c", "codex", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      windowsHide: true,
      encoding: "utf8",
    });
  }
  return execFileSync("codex", args, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    windowsHide: true,
    encoding: "utf8",
  });
}

function printJsonSummary(json) {
  const obj = toObject(json);
  if (!obj) {
    console.log("json summary: non-object payload");
    return;
  }
  const rateLimits = toObject(obj.rate_limits) || toObject(obj.rateLimits) || obj;
  const primary = toObject(rateLimits.primary) || {};
  const secondary = toObject(rateLimits.secondary) || {};
  const planType = pickFirstString([rateLimits.plan_type, rateLimits.planType, obj.plan_type, obj.planType]);

  console.log("json summary:");
  if (planType) console.log(`  plan_type: ${planType}`);
  printIf("  primary.used_percent", pickFirstNumber([primary.used_percent, primary.usedPercent, obj.primary_used_percent]));
  printIf(
    "  secondary.used_percent",
    pickFirstNumber([secondary.used_percent, secondary.usedPercent, obj.secondary_used_percent]),
  );
  printIf(
    "  primary.reset_after_seconds",
    pickFirstNumber([primary.reset_after_seconds, primary.resetAfterSeconds, obj.primary_reset_after_seconds]),
  );
  printIf(
    "  secondary.reset_after_seconds",
    pickFirstNumber([secondary.reset_after_seconds, secondary.resetAfterSeconds, obj.secondary_reset_after_seconds]),
  );

  const safePreview = redactSecrets(json);
  console.log(`  raw preview: ${JSON.stringify(safePreview).slice(0, 300)}`);
}

function printIf(label, value) {
  if (value != null) {
    console.log(`${label}: ${value}`);
  }
}

function findFirstString(input, keys, depth = 0) {
  if (depth > 6 || input == null || typeof input !== "object") return null;
  if (Array.isArray(input)) {
    for (const item of input) {
      const nested = findFirstString(item, keys, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  for (const [key, value] of Object.entries(input)) {
    if (keys.has(key) && typeof value === "string" && value.trim()) return value;
  }
  for (const value of Object.values(input)) {
    const nested = findFirstString(value, keys, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function readArgValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx < 0) return null;
  return args[idx + 1] ?? null;
}

function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function pickFirstNumber(values) {
  for (const value of values) {
    const n = toNumber(value);
    if (n != null) return n;
  }
  return null;
}

function pickFirstString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function redactSecrets(value) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
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
