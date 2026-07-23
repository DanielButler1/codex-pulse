import type {
  AppSettings,
  AppStatus,
  AppUpdateState,
  CodexResetCreditsResult,
  HistoryRange,
  ModelUsageHeatmapData,
  ModelUsageHeatmapProgress,
  ModelUsageRange,
  ModelUsageSummary,
  ProviderConfigurationUpdate,
  ProviderConfigurationView,
  ProviderUsageResult,
  UsageSnapshot,
} from "./types";

export const codexPulseApi = {
  getLatestUsage: (): Promise<UsageSnapshot | null> => window.codexPulse.getLatestUsage(),
  getUsageHistory: (range: HistoryRange): Promise<UsageSnapshot[]> =>
    window.codexPulse.getUsageHistory(range),
  getModelUsage: (range: ModelUsageRange, periodStart?: number | null): Promise<ModelUsageSummary> =>
    window.codexPulse.getModelUsage(range, periodStart),
  getModelUsageHeatmap: (): Promise<ModelUsageHeatmapData> =>
    window.codexPulse.getModelUsageHeatmap(),
  getCodexResetCredits: (forceRefresh = false): Promise<CodexResetCreditsResult> =>
    window.codexPulse.getCodexResetCredits(forceRefresh),
  getProviderUsage: (providerId: string): Promise<ProviderUsageResult> =>
    window.codexPulse.getProviderUsage(providerId),
  getProviderConfig: (providerId: string): Promise<ProviderConfigurationView> =>
    window.codexPulse.getProviderConfig(providerId),
  updateProviderConfig: (update: ProviderConfigurationUpdate): Promise<ProviderConfigurationView> =>
    window.codexPulse.updateProviderConfig(update),
  refreshNow: (): Promise<UsageSnapshot> => window.codexPulse.refreshNow(),
  getStatus: (): Promise<AppStatus | null> => window.codexPulse.getStatus(),
  isPackaged: (): Promise<boolean> => window.codexPulse.isPackaged(),
  getUpdateState: (): Promise<AppUpdateState> => window.codexPulse.getUpdateState(),
  checkForUpdates: (): Promise<AppUpdateState> => window.codexPulse.checkForUpdates(),
  downloadUpdate: (): Promise<AppUpdateState> => window.codexPulse.downloadUpdate(),
  installUpdate: (): Promise<AppUpdateState> => window.codexPulse.installUpdate(),
  simulateUpdateAvailable: (version?: string): Promise<AppUpdateState> =>
    window.codexPulse.simulateUpdateAvailable(version),
  clearUpdateSimulation: (): Promise<AppUpdateState> => window.codexPulse.clearUpdateSimulation(),
  getSettings: (): Promise<AppSettings> => window.codexPulse.getSettings(),
  updateSettings: (settings: Partial<AppSettings>): Promise<void> =>
    window.codexPulse.updateSettings(settings),
  subscribe(listener: () => void): (() => void) | null {
    if (!window.codexPulse.onUpdated) {
      return null;
    }
    return window.codexPulse.onUpdated(listener);
  },
  subscribeToUpdateState(listener: () => void): (() => void) | null {
    if (!window.codexPulse.onUpdateState) {
      return null;
    }
    return window.codexPulse.onUpdateState(listener);
  },
  subscribeToModelUsageHeatmapProgress(
    listener: (progress: ModelUsageHeatmapProgress) => void,
  ): (() => void) | null {
    if (!window.codexPulse.onModelUsageHeatmapProgress) {
      return null;
    }
    return window.codexPulse.onModelUsageHeatmapProgress(listener);
  },
};
