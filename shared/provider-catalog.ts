export const PROVIDER_IDS = [
  "codex",
  "claude",
  "cursor",
  "opencode",
  "opencodego",
  "alibaba",
  "factory",
  "gemini",
  "antigravity",
  "copilot",
  "zai",
  "minimax",
  "kimi",
  "kilo",
  "kiro",
  "vertexai",
  "augment",
  "jetbrains",
  "kimik2",
  "amp",
  "ollama",
  "synthetic",
  "warp",
  "openrouter",
  "perplexity",
  "abacus",
  "mistral",
  "deepseek",
  "codebuff",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderAvailability = "active" | "inactive";

export type ProviderDashboardKind = "codex" | "limits" | "quota" | "credits" | "balance" | "openrouter" | "comingSoon";

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

const API_KEY_SETTINGS: ProviderSettingsSpec = {
  requiresManualConfig: true,
  modeOptions: ["auto", "api"],
  secretFields: ["apiKey"],
  hint: "Requires API key/token.",
  showAdvancedFields: false,
};

const COOKIE_SETTINGS: ProviderSettingsSpec = {
  requiresManualConfig: true,
  modeOptions: ["auto", "web"],
  secretFields: ["sessionCookie"],
  hint: "Requires browser cookie/session token when auto detection is unavailable.",
  showAdvancedFields: false,
};

const CLI_SETTINGS: ProviderSettingsSpec = {
  requiresManualConfig: true,
  modeOptions: ["auto", "cli"],
  secretFields: [],
  hint: "Uses local CLI authentication; optional CLI path override.",
  showAdvancedFields: true,
};

const WEB_OR_API_SETTINGS: ProviderSettingsSpec = {
  requiresManualConfig: true,
  modeOptions: ["auto", "web", "api"],
  secretFields: ["apiKey", "sessionCookie"],
  hint: "Supports either web session cookies or API token.",
  showAdvancedFields: true,
};

const CODEX_DASHBOARD: ProviderDashboardSpec = {
  kind: "codex",
  summary: "App-server JSON-RPC, dashboard extras, and local rollout logs.",
  primaryLabel: "5 hour usage limit",
  secondaryLabel: "Weekly usage limit",
  balanceLabel: "Credits remaining",
  showPrediction: true,
  showModelUsage: true,
};

const COMING_SOON_DASHBOARD: ProviderDashboardSpec = {
  kind: "comingSoon",
  summary: "Coming soon.",
  primaryLabel: "Coming soon",
  showPrediction: false,
  showModelUsage: false,
};

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "codex",
    label: "Codex",
    shortLabel: "Codex",
    availability: "active",
    description: "Native collector with app-server + rollout fallback paths.",
    settings: NO_MANUAL_SETTINGS,
    dashboard: CODEX_DASHBOARD,
  },
  {
    id: "claude",
    label: "Claude Code",
    shortLabel: "Claude",
    availability: "inactive",
    description: "Native provider collector.",
    settings: CLI_SETTINGS,
    dashboard: COMING_SOON_DASHBOARD,
  },
  { id: "cursor", label: "Cursor", shortLabel: "Cursor", availability: "inactive", description: "Coming soon.", settings: COOKIE_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "opencode", label: "OpenCode", shortLabel: "OpenCode", availability: "inactive", description: "Coming soon.", settings: COOKIE_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "opencodego", label: "OpenCode Go", shortLabel: "OpenCode Go", availability: "inactive", description: "Coming soon.", settings: COOKIE_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "alibaba", label: "Alibaba Coding Plan", shortLabel: "Alibaba", availability: "inactive", description: "Coming soon.", settings: WEB_OR_API_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "factory", label: "Droid / Factory", shortLabel: "Factory", availability: "inactive", description: "Coming soon.", settings: COOKIE_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "gemini", label: "Gemini", shortLabel: "Gemini", availability: "inactive", description: "Coming soon.", settings: NO_MANUAL_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "antigravity", label: "Antigravity", shortLabel: "Antigravity", availability: "inactive", description: "Coming soon.", settings: NO_MANUAL_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "copilot", label: "GitHub Copilot", shortLabel: "Copilot", availability: "inactive", description: "Coming soon.", settings: API_KEY_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "zai", label: "z.ai", shortLabel: "z.ai", availability: "inactive", description: "Coming soon.", settings: API_KEY_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "minimax", label: "MiniMax", shortLabel: "MiniMax", availability: "inactive", description: "Coming soon.", settings: WEB_OR_API_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "kimi", label: "Kimi", shortLabel: "Kimi", availability: "inactive", description: "Coming soon.", settings: COOKIE_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "kilo", label: "Kilo", shortLabel: "Kilo", availability: "inactive", description: "Coming soon.", settings: API_KEY_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "kiro", label: "Kiro", shortLabel: "Kiro", availability: "inactive", description: "Coming soon.", settings: NO_MANUAL_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "vertexai", label: "Vertex AI", shortLabel: "Vertex AI", availability: "inactive", description: "Coming soon.", settings: NO_MANUAL_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "augment", label: "Augment", shortLabel: "Augment", availability: "inactive", description: "Coming soon.", settings: COOKIE_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "jetbrains", label: "JetBrains AI", shortLabel: "JetBrains", availability: "inactive", description: "Coming soon.", settings: NO_MANUAL_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "kimik2", label: "Kimi K2", shortLabel: "Kimi K2", availability: "inactive", description: "Coming soon.", settings: API_KEY_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "amp", label: "Amp", shortLabel: "Amp", availability: "inactive", description: "Coming soon.", settings: COOKIE_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "ollama", label: "Ollama", shortLabel: "Ollama", availability: "inactive", description: "Coming soon.", settings: COOKIE_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "synthetic", label: "Synthetic", shortLabel: "Synthetic", availability: "inactive", description: "Coming soon.", settings: API_KEY_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "warp", label: "Warp", shortLabel: "Warp", availability: "inactive", description: "Coming soon.", settings: API_KEY_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "openrouter", label: "OpenRouter", shortLabel: "OpenRouter", availability: "inactive", description: "Coming soon.", settings: API_KEY_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "perplexity", label: "Perplexity", shortLabel: "Perplexity", availability: "inactive", description: "Coming soon.", settings: COOKIE_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "abacus", label: "Abacus AI", shortLabel: "Abacus", availability: "inactive", description: "Coming soon.", settings: COOKIE_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "mistral", label: "Mistral", shortLabel: "Mistral", availability: "inactive", description: "Coming soon.", settings: COOKIE_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "deepseek", label: "DeepSeek", shortLabel: "DeepSeek", availability: "inactive", description: "Coming soon.", settings: NO_MANUAL_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
  { id: "codebuff", label: "Codebuff", shortLabel: "Codebuff", availability: "inactive", description: "Coming soon.", settings: API_KEY_SETTINGS, dashboard: COMING_SOON_DASHBOARD },
];
