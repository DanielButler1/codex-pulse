export const PROVIDER_IDS = ["codex"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderAvailability = "active";
export type ProviderDashboardKind = "codex";
export type ProviderSecretField = "apiKey" | "bearerToken" | "refreshToken" | "sessionCookie";
export type ProviderModeOption = "auto" | "api" | "cli" | "web" | "logs";

export type ProviderSettingsSpec = {
  requiresManualConfig: boolean;
  modeOptions: ProviderModeOption[];
  secretFields: ProviderSecretField[];
  hint: string;
  showAdvancedFields: boolean;
};

export type ProviderDashboardSpec = {
  kind: ProviderDashboardKind;
  summary: string;
  primaryLabel: string;
  secondaryLabel?: string;
  balanceLabel?: string;
  showPrediction: boolean;
  showModelUsage: boolean;
};

export type ProviderCatalogEntry = {
  id: ProviderId;
  label: string;
  shortLabel: string;
  availability: ProviderAvailability;
  description: string;
  settings: ProviderSettingsSpec;
  dashboard: ProviderDashboardSpec;
};

const NO_MANUAL_SETTINGS: ProviderSettingsSpec = {
  requiresManualConfig: false,
  modeOptions: ["auto"],
  secretFields: [],
  hint: "No manual credentials required.",
  showAdvancedFields: false,
};

const CODEX_DASHBOARD: ProviderDashboardSpec = {
  kind: "codex",
  summary: "Weekly limits, projection, and local rollout usage.",
  primaryLabel: "5 hour usage limit",
  secondaryLabel: "Weekly usage limit",
  balanceLabel: "Credits remaining",
  showPrediction: true,
  showModelUsage: true,
};

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "codex",
    label: "Codex",
    shortLabel: "Codex",
    availability: "active",
    description: "Native collector with app-server and rollout fallback paths.",
    settings: NO_MANUAL_SETTINGS,
    dashboard: CODEX_DASHBOARD,
  },
];
