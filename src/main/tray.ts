import fs from "node:fs";
import path from "node:path";
import { app, Menu, Tray, nativeImage } from "electron";
import type { UsageSnapshot } from "../../shared/types";

type TrayCallbacks = {
  onOpen: () => void;
  onRefreshNow: () => void;
  onToggleStartAtLogin: (enabled: boolean) => void;
  onQuit: () => void;
};

export class TrayController {
  private tray: Tray | null = null;
  private startAtLogin = false;
  private callbacks: TrayCallbacks | null = null;

  create(startAtLogin: boolean, callbacks: TrayCallbacks) {
    this.startAtLogin = startAtLogin;
    this.callbacks = callbacks;
    if (this.tray) {
      return;
    }

    this.tray = new Tray(createTrayIcon());
    this.tray.setToolTip("Codex: waiting for data");
    this.tray.on("click", () => callbacks.onOpen());
    this.rebuildMenu();
  }

  update(snapshot: UsageSnapshot | null, startAtLogin: boolean) {
    this.startAtLogin = startAtLogin;
    if (!this.tray) {
      return;
    }
    this.tray.setToolTip(buildTooltip(snapshot));
    this.rebuildMenu();
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
  }

  private rebuildMenu() {
    if (!this.tray || !this.callbacks) {
      return;
    }
    const menu = Menu.buildFromTemplate([
      {
        label: "Open Codex Pulse",
        click: () => this.callbacks?.onOpen(),
      },
      {
        label: "Refresh now",
        click: () => this.callbacks?.onRefreshNow(),
      },
      { type: "separator" },
      {
        label: "Start at login",
        type: "checkbox",
        checked: this.startAtLogin,
        click: (menuItem) => this.callbacks?.onToggleStartAtLogin(menuItem.checked),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => this.callbacks?.onQuit(),
      },
    ]);
    this.tray.setContextMenu(menu);
  }
}

function buildTooltip(snapshot: UsageSnapshot | null): string {
  if (!snapshot) {
    return "Codex: waiting for data";
  }
  const primaryRemaining =
    snapshot.primaryUsedPercent != null ? `${(100 - snapshot.primaryUsedPercent).toFixed(0)}%` : "n/a";
  const secondaryRemaining =
    snapshot.secondaryUsedPercent != null
      ? `${(100 - snapshot.secondaryUsedPercent).toFixed(0)}%`
      : "n/a";
  return `Codex left: ${primaryRemaining} primary, ${secondaryRemaining} weekly`;
}

function createTrayIcon() {
  const iconPath = resolveTrayIconPath();
  if (iconPath && fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  const fallback = nativeImage.createEmpty();
  return fallback.resize({ width: 16, height: 16 });
}

function resolveTrayIconPath(): string | null {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icon.png");
  }
  return path.join(process.cwd(), "build", "icon.png");
}
