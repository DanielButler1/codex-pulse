import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import type { ProviderSecretFlags, ProviderSecretInput } from "../../../shared/types";

type SecretMap = Record<string, ProviderSecretInput>;

const SECRET_KEYS: Array<keyof ProviderSecretInput> = [
  "apiKey",
  "bearerToken",
  "refreshToken",
  "sessionCookie",
];

export class ProviderSecretsStore {
  private readonly filePath: string;
  private readonly fallbackFilePath: string;
  private data: SecretMap = {};

  constructor(baseDir: string) {
    this.filePath = path.join(baseDir, "provider-secrets.bin");
    this.fallbackFilePath = path.join(baseDir, "provider-secrets.json");
    this.data = this.load();
  }

  getSecrets(providerId: string): ProviderSecretInput {
    return { ...(this.data[providerId] ?? {}) };
  }

  getFlags(providerId: string): ProviderSecretFlags {
    const secrets = this.getSecrets(providerId);
    return {
      hasApiKey: hasSecret(secrets.apiKey),
      hasBearerToken: hasSecret(secrets.bearerToken),
      hasRefreshToken: hasSecret(secrets.refreshToken),
      hasSessionCookie: hasSecret(secrets.sessionCookie),
    };
  }

  update(providerId: string, partial: ProviderSecretInput): ProviderSecretFlags {
    const existing = this.data[providerId] ?? {};
    const next: ProviderSecretInput = { ...existing };

    for (const key of SECRET_KEYS) {
      if (partial[key] === undefined) {
        continue;
      }
      const value = String(partial[key] ?? "").trim();
      if (value.length === 0) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }

    this.data[providerId] = next;
    this.save();
    return this.getFlags(providerId);
  }

  private load(): SecretMap {
    try {
      if (fs.existsSync(this.filePath)) {
        const encoded = fs.readFileSync(this.filePath, "utf8").trim();
        if (!encoded) {
          return {};
        }
        if (!safeStorage.isEncryptionAvailable()) {
          return {};
        }
        const decrypted = safeStorage.decryptString(Buffer.from(encoded, "base64"));
        return sanitizeSecretMap(JSON.parse(decrypted));
      }

      if (fs.existsSync(this.fallbackFilePath)) {
        const raw = fs.readFileSync(this.fallbackFilePath, "utf8");
        return sanitizeSecretMap(JSON.parse(raw));
      }
    } catch {
      return {};
    }
    return {};
  }

  private save() {
    const sanitized = sanitizeSecretMap(this.data);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (safeStorage.isEncryptionAvailable()) {
      const plaintext = JSON.stringify(sanitized);
      const encrypted = safeStorage.encryptString(plaintext);
      fs.writeFileSync(this.filePath, encrypted.toString("base64"), "utf8");
      if (fs.existsSync(this.fallbackFilePath)) {
        fs.rmSync(this.fallbackFilePath, { force: true });
      }
      return;
    }
    fs.writeFileSync(this.fallbackFilePath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  }
}

function sanitizeSecretMap(input: unknown): SecretMap {
  if (!input || typeof input !== "object") {
    return {};
  }
  const map: SecretMap = {};
  for (const [providerId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const secret: ProviderSecretInput = {};
    for (const key of SECRET_KEYS) {
      const raw = (value as Record<string, unknown>)[key];
      if (typeof raw !== "string") {
        continue;
      }
      const trimmed = raw.trim();
      if (trimmed) {
        secret[key] = trimmed;
      }
    }
    map[providerId] = secret;
  }
  return map;
}

function hasSecret(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
