import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  nativeTheme,
} from "electron";
import type {
  AppSettings,
  AppStatus,
  AppUpdateState,
  CodexResetCreditsResult,
  HistoryRange,
  ModelUsageRange,
  ProviderConfigurationUpdate,
  ProviderConfigurationView,
  ProviderConnectionSettings,
  ProviderUsageResult,
  UsageSnapshot,
} from "../../shared/types";
import { UsageDatabase } from "./db";
import { DEFAULT_SETTINGS, SettingsStore } from "./settings";
import { fetchProviderUsageNative } from "./services/provider-usage";
import { ProviderSecretsStore } from "./services/provider-secrets";
import { getAllTimeModelUsageHeatmap, getModelUsageSummary } from "./services/model-usage";
import { CodexUsageService } from "./services/codex-usage";
import { fetchCodexResetCredits } from "./services/codex-reset-credits";
import { UsageScheduler } from "./services/scheduler";
import { AppUpdaterService } from "./services/updater";
import { TrayController } from "./tray";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let scheduler: UsageScheduler | null = null;
let db: UsageDatabase | null = null;
let settingsStore: SettingsStore | null = null;
let providerSecretsStore: ProviderSecretsStore | null = null;
let trayController: TrayController | null = null;
let updaterService: AppUpdaterService | null = null;
let isQuitting = false;
let latestSnapshot: UsageSnapshot | null = null;
let latestStatus: AppStatus | null = null;
let latestSettings: AppSettings | null = null;
let latestUpdateState: AppUpdateState | null = null;
let shouldShowWindowOnReady = true;
const providerUsageCache = new Map<string, { result: ProviderUsageResult; cachedAt: number }>();
const providerUsageInflight = new Map<string, Promise<ProviderUsageResult>>();
let resetCreditsCache: { result: CodexResetCreditsResult; cachedAt: number } | null = null;
let resetCreditsInflight: Promise<CodexResetCreditsResult> | null = null;
const RESET_CREDITS_CACHE_TTL_MS = 5 * 60 * 1000;

const FALLBACK_PROVIDER_SETTINGS: ProviderConnectionSettings = {
  enabled: true,
  mode: "auto",
  apiBaseUrl: "",
  cliPath: "",
  accountId: "",
  workspacePath: "",
  headersJson: "",
  notes: "",
};

const notifiedByThreshold = new Map<number, string>();
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function createWindow() {
  if (mainWindow) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: "Codex Pulse",
    show: false,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.removeMenu();

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (shouldShowWindowOnReady) {
      mainWindow?.show();
    }
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

function showWindow() {
  const window = createWindow();
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

async function bootstrap() {
  app.setAppUserModelId("com.codexpulse.desktop");

  settingsStore = new SettingsStore(app.getPath("userData"));
  providerSecretsStore = new ProviderSecretsStore(app.getPath("userData"));
  latestSettings = settingsStore.get();
  applyTheme(latestSettings.theme);
  configureAutoLaunch(latestSettings.startAtLogin);
  // Packaged builds are tray-first: start the watcher/logger silently and let the tray
  // open the window on demand instead of flashing UI on login or installer launch.
  shouldShowWindowOnReady = !app.isPackaged;

  const dbPath = path.join(app.getPath("userData"), "codex-pulse.db");
  db = new UsageDatabase(dbPath);

  const usageService = new CodexUsageService();
  updaterService = new AppUpdaterService({
    onUpdateState: (state) => {
      latestUpdateState = state;
      mainWindow?.webContents.send("codexPulse:updateState");
    },
  });
  updaterService.init();
  latestUpdateState = updaterService.getState();

  scheduler = new UsageScheduler({
    db,
    usageService,
    settings: latestSettings,
    onUpdate: (snapshot, status) => {
      const previousSnapshot = latestSnapshot;
      latestSnapshot = snapshot;
      latestStatus = status;
      trayController?.update(snapshot, latestSettings?.startAtLogin ?? false);
      maybeNotifyThreshold(snapshot, previousSnapshot);
      mainWindow?.webContents.send("codexPulse:updated");
    },
  });

  latestSnapshot = scheduler.getLatestSnapshot();
  latestStatus = scheduler.getStatus();

  trayController = new TrayController();
  trayController.create(latestSettings.startAtLogin, {
    onOpen: showWindow,
    onRefreshNow: () => {
      void scheduler?.refreshNow().catch(() => undefined);
    },
    onToggleStartAtLogin: (enabled) => {
      if (!settingsStore || !scheduler) {
        return;
      }
      latestSettings = settingsStore.update({ startAtLogin: enabled });
      scheduler.updateSettings(latestSettings);
      configureAutoLaunch(enabled);
      trayController?.update(latestSnapshot, enabled);
    },
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });
  trayController.update(latestSnapshot, latestSettings.startAtLogin);

  createWindow();
  scheduler.start();
}

function registerIpc() {
  ipcMain.handle("codexPulse:getLatestUsage", async () => latestSnapshot);
  ipcMain.handle("codexPulse:getUsageHistory", async (_event, range: HistoryRange) => {
    if (!db) {
      return [];
    }
    return db.getHistory(range);
  });
  ipcMain.handle("codexPulse:getModelUsage", async (_event, range: ModelUsageRange, periodStart?: number | null) =>
    await getModelUsageSummary(range, periodStart ?? undefined),
  );
  ipcMain.handle("codexPulse:getModelUsageHeatmap", async () =>
    await getAllTimeModelUsageHeatmap(),
  );
  ipcMain.handle(
    "codexPulse:getCodexResetCredits",
    async (_event, forceRefresh?: boolean): Promise<CodexResetCreditsResult> =>
      getCodexResetCredits(Boolean(forceRefresh)),
  );
  ipcMain.handle(
    "codexPulse:getProviderUsage",
    async (_event, providerId: string): Promise<ProviderUsageResult> => {
      if (providerId === "codex") {
        return {
          providerId,
          checkedAt: Date.now(),
          source: latestStatus?.providerMode ?? null,
          snapshot: latestSnapshot,
          error: latestStatus?.lastError ?? null,
          note: latestStatus?.authMessage ?? null,
        };
      }
      const ttlMs = getProviderUsageCacheTtl(providerId);
      const cached = providerUsageCache.get(providerId);
      if (cached && Date.now() - cached.cachedAt < ttlMs) {
        return cached.result;
      }
      const inflight = providerUsageInflight.get(providerId);
      if (inflight) {
        return inflight;
      }
      if (cached) {
        void refreshProviderUsage(providerId);
        return cached.result;
      }
      return refreshProviderUsage(providerId);
    },
  );
  ipcMain.handle(
    "codexPulse:getProviderConfig",
    async (_event, providerId: string): Promise<ProviderConfigurationView> =>
      buildProviderConfigView(providerId),
  );
  ipcMain.handle(
    "codexPulse:updateProviderConfig",
    async (_event, update: ProviderConfigurationUpdate): Promise<ProviderConfigurationView> => {
      if (!settingsStore) {
        throw new Error("Settings store not ready.");
      }
      const { providerId } = update;
      const current = resolveProviderSettings(providerId);
      if (update.settings) {
        latestSettings = settingsStore.update({
          providerSettings: {
            [providerId]: {
              ...current,
              ...update.settings,
            },
          },
        });
      }
      if (update.secrets) {
        providerSecretsStore?.update(providerId, update.secrets);
      }
      providerUsageCache.delete(providerId);
      providerUsageInflight.delete(providerId);
      return buildProviderConfigView(providerId);
    },
  );
  ipcMain.handle("codexPulse:refreshNow", async () => {
    if (!scheduler) {
      throw new Error("Scheduler not ready.");
    }
    return scheduler.refreshNow();
  });
  ipcMain.handle("codexPulse:getStatus", async () => latestStatus);
  ipcMain.handle("codexPulse:isPackaged", async () => app.isPackaged);
  ipcMain.handle("codexPulse:getUpdateState", async () => latestUpdateState);
  ipcMain.handle("codexPulse:checkForUpdates", async () => updaterService?.checkForUpdates());
  ipcMain.handle("codexPulse:downloadUpdate", async () => updaterService?.downloadUpdate());
  ipcMain.handle("codexPulse:installUpdate", async () => updaterService?.installUpdate());
  ipcMain.handle("codexPulse:simulateUpdateAvailable", async (_event, version?: string) => {
    if (!updaterService) {
      throw new Error("Updater not ready.");
    }
    return updaterService.simulateAvailable(version);
  });
  ipcMain.handle("codexPulse:clearUpdateSimulation", async () => {
    if (!updaterService) {
      throw new Error("Updater not ready.");
    }
    return updaterService.clearSimulation();
  });
  ipcMain.handle(
    "codexPulse:getSettings",
    async () => latestSettings ?? settingsStore?.get() ?? DEFAULT_SETTINGS,
  );
  ipcMain.handle(
    "codexPulse:updateSettings",
    async (_event, partial: Partial<AppSettings>) => {
      if (!settingsStore || !scheduler) {
        return;
      }
      latestSettings = settingsStore.update(partial);
      applyTheme(latestSettings.theme);
      configureAutoLaunch(latestSettings.startAtLogin);
      scheduler.updateSettings(latestSettings);
      trayController?.update(latestSnapshot, latestSettings.startAtLogin);
    },
  );
}

function resolveProviderSettings(providerId: string): ProviderConnectionSettings {
  const candidate = latestSettings?.providerSettings?.[providerId];
  if (!candidate) {
    return { ...FALLBACK_PROVIDER_SETTINGS };
  }
  return { ...candidate };
}

function getProviderUsageCacheTtl(providerId: string): number {
  if (providerId === "openrouter") {
    return 5 * 60 * 1000;
  }
  return 60 * 1000;
}

function refreshProviderUsage(
  providerId: string,
  settingsOverride?: ProviderConnectionSettings,
  secretsOverride?: ReturnType<ProviderSecretsStore["getSecrets"]>,
): Promise<ProviderUsageResult> {
  const inflight = providerUsageInflight.get(providerId);
  if (inflight) {
    return inflight;
  }
  const settings = settingsOverride ?? resolveProviderSettings(providerId);
  const secrets = secretsOverride ?? providerSecretsStore?.getSecrets(providerId) ?? {};
  const request = fetchProviderUsageNative(providerId, { settings, secrets }).then((result) => {
    providerUsageCache.set(providerId, { result, cachedAt: Date.now() });
    providerUsageInflight.delete(providerId);
    return result;
  });
  providerUsageInflight.set(providerId, request);
  return request;
}

function getCodexResetCredits(forceRefresh: boolean): Promise<CodexResetCreditsResult> {
  if (
    !forceRefresh &&
    resetCreditsCache &&
    Date.now() - resetCreditsCache.cachedAt < RESET_CREDITS_CACHE_TTL_MS
  ) {
    return Promise.resolve(resetCreditsCache.result);
  }
  if (resetCreditsInflight) {
    return resetCreditsInflight;
  }

  resetCreditsInflight = fetchCodexResetCredits().then((result) => {
    resetCreditsCache = result.error ? null : { result, cachedAt: Date.now() };
    resetCreditsInflight = null;
    return result;
  });
  return resetCreditsInflight;
}

function buildProviderConfigView(providerId: string): ProviderConfigurationView {
  return {
    providerId,
    settings: resolveProviderSettings(providerId),
    secretFlags: providerSecretsStore?.getFlags(providerId) ?? {
      hasApiKey: false,
      hasBearerToken: false,
      hasRefreshToken: false,
      hasSessionCookie: false,
    },
  };
}

function maybeNotifyThreshold(snapshot: UsageSnapshot | null, previousSnapshot: UsageSnapshot | null) {
  if (!snapshot || !latestSettings?.notificationsEnabled) {
    return;
  }
  const current = snapshot.primaryUsedPercent;
  const resetAfter = snapshot.primaryResetAfterSeconds;
  if (current == null || resetAfter == null) {
    return;
  }

  const windowKey = buildWindowKey(snapshot.checkedAt, resetAfter);
  const previous = previousSnapshot?.primaryUsedPercent ?? null;
  const thresholds = [70, 85, 95];

  for (const threshold of thresholds) {
    const alreadySent = notifiedByThreshold.get(threshold) === windowKey;
    const crossed =
      previous == null ? current >= threshold : previous < threshold && current >= threshold;

    if (crossed && !alreadySent) {
      notifiedByThreshold.set(threshold, windowKey);
      new Notification({
        title: "Codex Pulse",
        body: `Primary usage reached ${threshold}% (current ${current.toFixed(1)}%).`,
      }).show();
    }

    if (current < threshold && alreadySent) {
      notifiedByThreshold.delete(threshold);
    }
  }
}

function buildWindowKey(checkedAt: number, resetAfterSeconds: number): string {
  const resetEpoch = checkedAt + resetAfterSeconds * 1000;
  return `${Math.floor(resetEpoch / (5 * 60 * 1000))}`;
}

function applyTheme(theme: AppSettings["theme"]) {
  switch (theme) {
    case "dark":
      nativeTheme.themeSource = "dark";
      break;
    case "light":
      nativeTheme.themeSource = "light";
      break;
    default:
      nativeTheme.themeSource = "system";
      break;
  }
}

function configureAutoLaunch(enabled: boolean) {
  if (!app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: false });
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: enabled });
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });

  registerIpc();

  app.whenReady().then(bootstrap);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      showWindow();
    } else {
      showWindow();
    }
  });

  app.on("window-all-closed", () => {
    // Keep running in tray on Windows/Linux. On macOS this behavior is standard.
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("will-quit", () => {
    scheduler?.stop();
    db?.close();
    trayController?.destroy();
    updaterService?.destroy();
  });
}
