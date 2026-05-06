import { app } from "electron";
import updaterPkg from "electron-updater";
import type { AppUpdateState } from "../../../shared/types";

const { autoUpdater } = updaterPkg;

type UpdaterCallbacks = {
  onUpdateState?: (state: AppUpdateState) => void;
};

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export class AppUpdaterService {
  private readonly callbacks: UpdaterCallbacks;
  private state: AppUpdateState;
  private timer: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor(callbacks: UpdaterCallbacks = {}) {
    this.callbacks = callbacks;
    this.state = {
      status: app.isPackaged ? "checking" : "unavailable",
      version: null,
      progress: null,
      lastCheckedAt: null,
      error: null,
    };
  }

  init() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    if (!app.isPackaged) {
      const demoVersion = process.env.CODEX_PULSE_DEMO_UPDATE;
      if (demoVersion) {
        this.simulateAvailable(demoVersion === "1" ? "0.0.0-dev" : demoVersion);
      } else {
        this.emit();
      }
      return;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.channel = "beta";

    autoUpdater.on("checking-for-update", () => {
      this.setState({
        status: "checking",
        error: null,
        lastCheckedAt: Date.now(),
      });
    });

    autoUpdater.on("update-available", (info) => {
      this.setState({
        status: "available",
        version: info.version,
        progress: null,
        error: null,
        lastCheckedAt: Date.now(),
      });
    });

    autoUpdater.on("update-not-available", () => {
      this.setState({
        status: "unavailable",
        version: null,
        progress: null,
        error: null,
        lastCheckedAt: Date.now(),
      });
    });

    autoUpdater.on("download-progress", (progress) => {
      this.setState({
        status: "downloading",
        progress: progress.percent,
        error: null,
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      this.setState({
        status: "downloaded",
        version: info.version,
        progress: 100,
        error: null,
        lastCheckedAt: Date.now(),
      });
    });

    autoUpdater.on("error", (error) => {
      this.setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        progress: null,
        lastCheckedAt: Date.now(),
      });
    });

    void this.checkForUpdates();
    this.timer = setInterval(() => {
      if (this.state.status === "downloading" || this.state.status === "downloaded") {
        return;
      }
      void this.checkForUpdates().catch(() => undefined);
    }, CHECK_INTERVAL_MS);

    this.emit();
  }

  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getState(): AppUpdateState {
    return { ...this.state };
  }

  simulateAvailable(version = "0.0.0-dev"): AppUpdateState {
    if (app.isPackaged) {
      return this.getState();
    }
    this.setState({
      status: "available",
      version,
      progress: null,
      error: null,
      lastCheckedAt: Date.now(),
    });
    return this.getState();
  }

  clearSimulation(): AppUpdateState {
    if (app.isPackaged) {
      return this.getState();
    }
    this.setState({
      status: "unavailable",
      version: null,
      progress: null,
      error: null,
      lastCheckedAt: Date.now(),
    });
    return this.getState();
  }

  async checkForUpdates(): Promise<AppUpdateState> {
    if (!app.isPackaged) {
      this.clearSimulation();
      return this.getState();
    }

    this.setState({
      status: "checking",
      error: null,
      lastCheckedAt: Date.now(),
    });

    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result || !result.isUpdateAvailable) {
        this.setState({
          status: "unavailable",
          version: null,
          progress: null,
          error: null,
          lastCheckedAt: Date.now(),
        });
      }
    } catch (error) {
      this.setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        progress: null,
        lastCheckedAt: Date.now(),
      });
    }

    return this.getState();
  }

  async downloadUpdate(): Promise<AppUpdateState> {
    if (!app.isPackaged) {
      if (this.state.status !== "available") {
        return this.getState();
      }
      this.setState({
        status: "downloading",
        progress: 100,
        error: null,
        lastCheckedAt: Date.now(),
      });
      this.setState({
        status: "downloaded",
        progress: 100,
        error: null,
        lastCheckedAt: Date.now(),
      });
      return this.getState();
    }

    if (this.state.status !== "available") {
      return this.getState();
    }

    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        progress: null,
        lastCheckedAt: Date.now(),
      });
    }
    return this.getState();
  }

  installUpdate(): AppUpdateState {
    if (!app.isPackaged) {
      if (this.state.status === "downloaded") {
        this.clearSimulation();
      }
      return this.getState();
    }

    if (this.state.status !== "downloaded") {
      return this.getState();
    }

    autoUpdater.quitAndInstall(false, true);
    return this.getState();
  }

  private setState(next: Partial<AppUpdateState>) {
    this.state = { ...this.state, ...next };
    this.emit();
  }

  private emit() {
    this.callbacks.onUpdateState?.(this.getState());
  }
}
