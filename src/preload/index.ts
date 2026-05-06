import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  AppStatus,
  AppUpdateState,
  HistoryRange,
  ModelUsageHeatmapData,
  ModelUsageRange,
  ModelUsageSummary,
  ProviderConfigurationUpdate,
  ProviderConfigurationView,
  ProviderUsageResult,
  UsageSnapshot,
} from "../../shared/types";

const api = {
  getLatestUsage(): Promise<UsageSnapshot | null> {
    return ipcRenderer.invoke("codexPulse:getLatestUsage");
  },
  getUsageHistory(range: HistoryRange): Promise<UsageSnapshot[]> {
    return ipcRenderer.invoke("codexPulse:getUsageHistory", range);
  },
  getModelUsage(range: ModelUsageRange): Promise<ModelUsageSummary> {
    return ipcRenderer.invoke("codexPulse:getModelUsage", range);
  },
  getModelUsageHeatmap(): Promise<ModelUsageHeatmapData> {
    return ipcRenderer.invoke("codexPulse:getModelUsageHeatmap");
  },
  getProviderUsage(providerId: string): Promise<ProviderUsageResult> {
    return ipcRenderer.invoke("codexPulse:getProviderUsage", providerId);
  },
  getProviderConfig(providerId: string): Promise<ProviderConfigurationView> {
    return ipcRenderer.invoke("codexPulse:getProviderConfig", providerId);
  },
  updateProviderConfig(update: ProviderConfigurationUpdate): Promise<ProviderConfigurationView> {
    return ipcRenderer.invoke("codexPulse:updateProviderConfig", update);
  },
  refreshNow(): Promise<UsageSnapshot> {
    return ipcRenderer.invoke("codexPulse:refreshNow");
  },
  getStatus(): Promise<AppStatus | null> {
    return ipcRenderer.invoke("codexPulse:getStatus");
  },
  isPackaged(): Promise<boolean> {
    return ipcRenderer.invoke("codexPulse:isPackaged");
  },
  getUpdateState(): Promise<AppUpdateState> {
    return ipcRenderer.invoke("codexPulse:getUpdateState");
  },
  checkForUpdates(): Promise<AppUpdateState> {
    return ipcRenderer.invoke("codexPulse:checkForUpdates");
  },
  downloadUpdate(): Promise<AppUpdateState> {
    return ipcRenderer.invoke("codexPulse:downloadUpdate");
  },
  installUpdate(): Promise<AppUpdateState> {
    return ipcRenderer.invoke("codexPulse:installUpdate");
  },
  simulateUpdateAvailable(version?: string): Promise<AppUpdateState> {
    return ipcRenderer.invoke("codexPulse:simulateUpdateAvailable", version);
  },
  clearUpdateSimulation(): Promise<AppUpdateState> {
    return ipcRenderer.invoke("codexPulse:clearUpdateSimulation");
  },
  getSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke("codexPulse:getSettings");
  },
  updateSettings(settings: Partial<AppSettings>): Promise<void> {
    return ipcRenderer.invoke("codexPulse:updateSettings", settings);
  },
  onUpdated(listener: () => void): () => void {
    const handler = () => listener();
    ipcRenderer.on("codexPulse:updated", handler);
    return () => ipcRenderer.removeListener("codexPulse:updated", handler);
  },
  onUpdateState(listener: () => void): () => void {
    const handler = () => listener();
    ipcRenderer.on("codexPulse:updateState", handler);
    return () => ipcRenderer.removeListener("codexPulse:updateState", handler);
  },
};

contextBridge.exposeInMainWorld("codexPulse", api);
