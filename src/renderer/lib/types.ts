import type {
  AppSettings,
  AppStatus,
  AppUpdateState,
  CodexResetCreditsResult,
  HistoryRange,
  ModelUsageHeatmapData,
  ModelUsageHeatmapCell,
  ModelUsageRange,
  ModelUsageSummary,
  ProviderConfigurationUpdate,
  ProviderConfigurationView,
  ProviderConnectionSettings,
  ProviderSecretInput,
  ProviderSecretFlags,
  ProviderUsageResult,
  UsageSnapshot,
} from "../../../shared/types";

export type {
  AppSettings,
  AppStatus,
  AppUpdateState,
  CodexResetCreditsResult,
  HistoryRange,
  ModelUsageHeatmapData,
  ModelUsageHeatmapCell,
  ModelUsageRange,
  ModelUsageSummary,
  ProviderConfigurationUpdate,
  ProviderConfigurationView,
  ProviderConnectionSettings,
  ProviderSecretInput,
  ProviderSecretFlags,
  ProviderUsageResult,
  UsageSnapshot,
};

declare global {
  interface Window {
    codexPulse: {
      getLatestUsage(): Promise<UsageSnapshot | null>;
      getUsageHistory(range: HistoryRange): Promise<UsageSnapshot[]>;
      getModelUsage(range: ModelUsageRange, periodStart?: number | null): Promise<ModelUsageSummary>;
      getModelUsageHeatmap(): Promise<ModelUsageHeatmapData>;
      getCodexResetCredits(forceRefresh?: boolean): Promise<CodexResetCreditsResult>;
      getProviderUsage(providerId: string): Promise<ProviderUsageResult>;
      getProviderConfig(providerId: string): Promise<ProviderConfigurationView>;
      updateProviderConfig(update: ProviderConfigurationUpdate): Promise<ProviderConfigurationView>;
      refreshNow(): Promise<UsageSnapshot>;
      getStatus(): Promise<AppStatus | null>;
      isPackaged(): Promise<boolean>;
      getUpdateState(): Promise<AppUpdateState>;
      checkForUpdates(): Promise<AppUpdateState>;
      downloadUpdate(): Promise<AppUpdateState>;
      installUpdate(): Promise<AppUpdateState>;
      simulateUpdateAvailable(version?: string): Promise<AppUpdateState>;
      clearUpdateSimulation(): Promise<AppUpdateState>;
      getSettings(): Promise<AppSettings>;
      updateSettings(settings: Partial<AppSettings>): Promise<void>;
      onUpdated?: (listener: () => void) => () => void;
      onUpdateState?: (listener: () => void) => () => void;
    };
  }
}
