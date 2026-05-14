import fs from "node:fs";
import path from "node:path";
import { PROVIDER_IDS } from "../../shared/provider-catalog";
import type { AppSettings, ProviderCollectorMode, ProviderConnectionSettings } from "../../shared/types";

const DEFAULT_PROVIDER_CONNECTION: ProviderConnectionSettings = {
  enabled: true,
  mode: "auto",
  apiBaseUrl: "",
  cliPath: "",
  accountId: "",
  workspacePath: "",
  headersJson: "",
  notes: "",
};

function buildDefaultProviderSettings(): Record<string, ProviderConnectionSettings> {
  const settings: Record<string, ProviderConnectionSettings> = {};
  for (const providerId of PROVIDER_IDS) {
    settings[providerId] = { ...DEFAULT_PROVIDER_CONNECTION };
  }
  return settings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  pollIntervalSeconds: 60,
  startAtLogin: true,
  notificationsEnabled: true,
  theme: "dark",
  limitDisplayMode: "remaining",
  subscriptionPlan: "free",
  subscriptionLastRenewalDate: "",
  providerSettings: buildDefaultProviderSettings(),
};

type SettingsFile = Partial<AppSettings>;

export class SettingsStore {
  private readonly settingsPath: string;
  private settings: AppSettings = DEFAULT_SETTINGS;

  constructor(baseDir: string) {
    this.settingsPath = path.join(baseDir, "settings.json");
    this.settings = this.load();
  }

  get(): AppSettings {
    return cloneSettings(this.settings);
  }

  update(partial: Partial<AppSettings>): AppSettings {
    const next: AppSettings = sanitizeSettings({
      ...this.settings,
      providerSettings: {
        ...this.settings.providerSettings,
        ...(partial.providerSettings ?? {}),
      },
      ...partial,
    });
    this.settings = next;
    this.save(next);
    return cloneSettings(next);
  }

  private load(): AppSettings {
    if (!fs.existsSync(this.settingsPath)) {
      this.save(DEFAULT_SETTINGS);
      return cloneSettings(DEFAULT_SETTINGS);
    }

    try {
      const raw = fs.readFileSync(this.settingsPath, "utf8");
      const parsed = JSON.parse(raw) as SettingsFile;
      return sanitizeSettings(parsed);
    } catch {
      return cloneSettings(DEFAULT_SETTINGS);
    }
  }

  private save(settings: AppSettings) {
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    fs.writeFileSync(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }
}

function sanitizeSettings(input: SettingsFile): AppSettings {
  const theme =
    input.theme === "light" || input.theme === "system" || input.theme === "dark"
      ? input.theme
      : DEFAULT_SETTINGS.theme;
  const limitDisplayMode =
    input.limitDisplayMode === "used" || input.limitDisplayMode === "remaining"
      ? input.limitDisplayMode
      : DEFAULT_SETTINGS.limitDisplayMode;
  const providerSettings = sanitizeProviderSettings(input.providerSettings);

  return {
    // Polling is fixed to 60s to keep behavior predictable and avoid excessive writes.
    pollIntervalSeconds: 60,
    startAtLogin:
      typeof input.startAtLogin === "boolean" ? input.startAtLogin : DEFAULT_SETTINGS.startAtLogin,
    notificationsEnabled:
      typeof input.notificationsEnabled === "boolean"
        ? input.notificationsEnabled
        : DEFAULT_SETTINGS.notificationsEnabled,
    theme,
    limitDisplayMode,
    subscriptionPlan: sanitizeSubscriptionPlan(input.subscriptionPlan),
    subscriptionLastRenewalDate: sanitizeRenewalDate(input.subscriptionLastRenewalDate),
    providerSettings,
  };
}

function sanitizeSubscriptionPlan(value: AppSettings["subscriptionPlan"] | undefined): AppSettings["subscriptionPlan"] {
  switch (value) {
    case "go":
    case "plus":
    case "pro_5x":
    case "pro_20x":
    case "free":
      return value;
    default:
      return DEFAULT_SETTINGS.subscriptionPlan;
  }
}

function sanitizeRenewalDate(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function sanitizeProviderSettings(
  input: Partial<Record<string, ProviderConnectionSettings>> | undefined,
): Record<string, ProviderConnectionSettings> {
  const sanitized: Record<string, ProviderConnectionSettings> = {};
  for (const providerId of PROVIDER_IDS) {
    sanitized[providerId] = sanitizeProviderConnection(input?.[providerId]);
  }
  return sanitized;
}

function sanitizeProviderConnection(
  value: ProviderConnectionSettings | undefined,
): ProviderConnectionSettings {
  const allowedModes: ProviderCollectorMode[] = ["auto", "api", "cli", "web", "logs"];
  const mode = allowedModes.includes(value?.mode ?? "auto") ? (value?.mode ?? "auto") : "auto";
  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : DEFAULT_PROVIDER_CONNECTION.enabled,
    mode,
    apiBaseUrl: sanitizeString(value?.apiBaseUrl),
    cliPath: sanitizeString(value?.cliPath),
    accountId: sanitizeString(value?.accountId),
    workspacePath: sanitizeString(value?.workspacePath),
    headersJson: sanitizeString(value?.headersJson),
    notes: sanitizeString(value?.notes),
  };
}

function sanitizeString(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    providerSettings: Object.fromEntries(
      Object.entries(settings.providerSettings).map(([providerId, providerSettings]) => [
        providerId,
        { ...providerSettings },
      ]),
    ),
  };
}
