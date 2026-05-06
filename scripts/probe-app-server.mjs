#!/usr/bin/env node
import { spawn } from "node:child_process";

const timeoutMs = Number(process.argv[2] ?? "12000");

const isWindows = process.platform === "win32";
const command = isWindows
  ? { file: "cmd.exe", args: ["/d", "/s", "/c", "codex", "app-server"] }
  : { file: "codex", args: ["app-server"] };

const child = spawn(command.file, command.args, {
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});

let settled = false;
let account = null;
let rateLimits = null;

const finish = (label) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  try {
    child.kill();
  } catch {
    // ignore
  }

  console.log(`\nResult: ${label}`);
  console.log("account:");
  console.log(JSON.stringify(account, null, 2) || "null");
  console.log("rateLimits:");
  console.log(JSON.stringify(rateLimits, null, 2) || "null");
};

const onLine = (line) => {
  const parsed = safeJson(line);
  if (!parsed || typeof parsed !== "object") return;
  const o = parsed;

  if (o.id === 2 && o.result?.account) {
    account = o.result.account;
  }
  if (o.id === 3 && o.result?.rateLimits) {
    rateLimits = o.result.rateLimits;
    finish("got account/rateLimits/read response");
    return;
  }
  if (o.method === "account/rateLimits/updated" && o.params?.rateLimits) {
    rateLimits = o.params.rateLimits;
    finish("got account/rateLimits/updated notification");
  }
};

wire(child.stdout, onLine);
wire(child.stderr, onLine);

child.on("spawn", () => {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "codex-pulse-probe", version: "0.0.1" } },
  });
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  send({ jsonrpc: "2.0", id: 2, method: "account/read", params: { refreshToken: true } });
  send({ jsonrpc: "2.0", id: 3, method: "account/rateLimits/read", params: {} });
});

child.on("error", (error) => {
  finish(`error: ${error.message}`);
});
child.on("exit", (code) => {
  if (!settled) {
    finish(`process exited code ${code}`);
  }
});

const timer = setTimeout(() => {
  finish("timeout");
}, timeoutMs);

function send(obj) {
  child.stdin.write(`${JSON.stringify(obj)}\n`);
}

function wire(stream, onJsonLine) {
  stream.setEncoding("utf8");
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      onJsonLine(line);
    }
  });
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
