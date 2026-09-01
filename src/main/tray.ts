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
    if (process.platform === "darwin") {
      this.tray.setTitle("Pulse");
    }
    this.tray.on("click", () => callbacks.onOpen());
    this.rebuildMenu();
  }

  update(snapshot: UsageSnapshot | null, startAtLogin: boolean) {
    this.startAtLogin = startAtLogin;
    if (!this.tray) {
      return;
    }
    this.tray.setToolTip(buildTooltip(snapshot));
    if (process.platform === "darwin") {
      this.tray.setTitle(buildMenuBarTitle(snapshot));
    }
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

function buildMenuBarTitle(snapshot: UsageSnapshot | null): string {
  if (!snapshot || snapshot.primaryUsedPercent == null) {
    return "Pulse";
  }
  return `${Math.max(0, Math.min(100, 100 - snapshot.primaryUsedPercent)).toFixed(0)}%`;
}

function createTrayIcon() {
  if (process.platform === "darwin") {
    const image = nativeImage.createFromDataURL(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(MAC_TRAY_ICON_SVG)}`,
    );
    image.setTemplateImage(true);
    return image;
  }
  const iconPath = resolveTrayIconPath();
  if (iconPath && fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  const fallback = nativeImage.createEmpty();
  return fallback.resize({ width: 16, height: 16 });
}

const MAC_TRAY_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <path fill="#000" d="M1.5 9h3.1l1.5-4.4 2.3 8.8 1.7-5.1 1.2 2.2h5.2v-1.8h-4.1l-1.8-3.2-1.7 5.1-2.3-8.8L3.4 7.2H1.5z"/>
</svg>`;

function resolveTrayIconPath(): string | null {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icon.png");
  }
  return path.join(process.cwd(), "build", "icon.png");
}
