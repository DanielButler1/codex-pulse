export type UsageSnapshot = {
  id?: number;
  checkedAt: number;

  provider: string;
  accountLabel?: string;

  planType?: string;

  primaryUsedPercent: number | null;
  primaryResetAfterSeconds: number | null;
  primaryWindowMinutes?: number | null;

  secondaryUsedPercent: number | null;
  secondaryResetAfterSeconds: number | null;
  secondaryWindowMinutes?: number | null;

  creditsBalance?: number | null;
  creditsGranted?: number | null;
  creditsUsed?: number | null;

  raw?: unknown;
};

export type HistoryRange = "1h" | "6h" | "24h" | "7d" | "30d";
export type ModelUsageRange = HistoryRange | "period" | "sub_period" | "all";
export type SubscriptionPlan = "free" | "go" | "plus" | "pro_5x" | "pro_20x";

export type ProviderCollectorMode = "auto" | "api" | "cli" | "web" | "logs";

export type ProviderConnectionSettings = {
  enabled: boolean;
  mode: ProviderCollectorMode;
  apiBaseUrl: string;
  cliPath: string;
  accountId: string;
  workspacePath: string;
  headersJson: string;
  notes: string;
};

export type ProviderSecretInput = {
  apiKey?: string;
  bearerToken?: string;
  refreshToken?: string;
  sessionCookie?: string;
};

export type ProviderSecretFlags = {
  hasApiKey: boolean;
  hasBearerToken: boolean;
  hasRefreshToken: boolean;
  hasSessionCookie: boolean;
};

export type ProviderConfigurationView = {
  providerId: string;
  settings: ProviderConnectionSettings;
  secretFlags: ProviderSecretFlags;
};

export type ProviderConfigurationUpdate = {
  providerId: string;
  settings?: Partial<ProviderConnectionSettings>;
  secrets?: ProviderSecretInput;
};

export type AppSettings = {
  pollIntervalSeconds: number;
  startAtLogin: boolean;
  notificationsEnabled: boolean;
  theme: "dark" | "light" | "system";
  limitDisplayMode: "remaining" | "used";
  subscriptionPlan: SubscriptionPlan;
  subscriptionLastRenewalDate: string;
  providerSettings: Record<string, ProviderConnectionSettings>;
};

export type ProviderUsageResult = {
  providerId: string;
  checkedAt: number;
  source: string | null;
  snapshot: UsageSnapshot | null;
  error: string | null;
  note: string | null;
};

export type AuthStatus =
  | "ok"
  | "not_found"
  | "keychain_only"
  | "expired"
  | "error";

export type ProviderMode = "app_server" | "rollout" | "endpoint" | "cli" | "none";

export type AppStatus = {
  authStatus: AuthStatus;
  authMessage: string | null;
  lastCheckedAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  pollIntervalSeconds: number;
  effectivePollIntervalSeconds: number;
  consecutiveFailures: number;
  usingBackoff: boolean;
  providerMode: ProviderMode;
  burnRatePercentPerHour: number | null;
  estimatedLimitHitAt: number | null;
};

export type AppUpdateStatus =
  | "unavailable"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type AppUpdateState = {
  status: AppUpdateStatus;
  version: string | null;
  progress: number | null;
  lastCheckedAt: number | null;
  error: string | null;
};

export type ModelUsageRow = {
  model: string;
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type ModelUsageSummary = {
  range: ModelUsageRange;
  generatedAt: number;
  source: "rollout";
  models: ModelUsageRow[];
  totals: Omit<ModelUsageRow, "model">;
  monthProjection: {
    monthStart: number;
    monthEnd: number;
    elapsedRatio: number;
    tokensSoFar: number;
    estimatedCostSoFar: number;
    projectedTokens: number;
    projectedCostUsd: number;
  } | null;
  timeline: {
    granularity: "5m" | "15m" | "1h" | "6h" | "1d" | "1mo";
    buckets: Array<{
      bucketStart: number;
      totalTokens: number;
      estimatedCostUsd: number;
    }>;
  };
  monthly: Array<{
    monthStart: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }>;
  heatmap: {
    cells: Array<{
      dayIndex: number;
      hour: number;
      totalTokens: number;
    }>;
  };
};

export type ModelUsageHeatmapCell = {
  dayIndex: number;
  hour: number;
  totalTokens: number;
};

export type ModelUsageHeatmapData = {
  generatedAt: number;
  cells: ModelUsageHeatmapCell[];
};
