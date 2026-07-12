import type { UsageSnapshot } from "./types";

const SHORT_WINDOW_MAX_MINUTES = 24 * 60;
const WEEKLY_WINDOW_MIN_MINUTES = 6 * 24 * 60;

type LimitWindow = {
  usedPercent: number | null;
  resetAfterSeconds: number | null;
  windowMinutes: number | null;
};

/**
 * Codex normally reports the short window as `primary` and the weekly window
 * as `secondary`. During promotions or limit changes, app-server can omit one
 * window and move the remaining window into `primary`. Keep our semantic slots
 * stable by using the reported duration instead of trusting the field name.
 */
export function normalizeCodexLimitWindows(snapshot: UsageSnapshot): UsageSnapshot {
  if (snapshot.provider !== "codex") {
    return snapshot;
  }

  const primary = readWindow(snapshot, "primary");
  const secondary = readWindow(snapshot, "secondary");
  const hasPrimary = hasWindow(primary);
  const hasSecondary = hasWindow(secondary);

  if (hasPrimary && hasSecondary) {
    if (
      primary.windowMinutes != null &&
      secondary.windowMinutes != null &&
      primary.windowMinutes > secondary.windowMinutes
    ) {
      return writeWindows(snapshot, secondary, primary);
    }
    return snapshot;
  }

  if (hasPrimary && isWeeklyWindow(primary)) {
    return writeWindows(snapshot, emptyWindow(), primary);
  }

  if (hasSecondary && isShortWindow(secondary)) {
    return writeWindows(snapshot, secondary, emptyWindow());
  }

  return snapshot;
}

function readWindow(snapshot: UsageSnapshot, slot: "primary" | "secondary"): LimitWindow {
  return slot === "primary"
    ? {
        usedPercent: snapshot.primaryUsedPercent,
        resetAfterSeconds: snapshot.primaryResetAfterSeconds,
        windowMinutes: snapshot.primaryWindowMinutes ?? null,
      }
    : {
        usedPercent: snapshot.secondaryUsedPercent,
        resetAfterSeconds: snapshot.secondaryResetAfterSeconds,
        windowMinutes: snapshot.secondaryWindowMinutes ?? null,
      };
}

function hasWindow(window: LimitWindow): boolean {
  return (
    window.usedPercent != null ||
    window.resetAfterSeconds != null ||
    window.windowMinutes != null
  );
}

function isWeeklyWindow(window: LimitWindow): boolean {
  return window.windowMinutes != null && window.windowMinutes >= WEEKLY_WINDOW_MIN_MINUTES;
}

function isShortWindow(window: LimitWindow): boolean {
  return window.windowMinutes != null && window.windowMinutes <= SHORT_WINDOW_MAX_MINUTES;
}

function emptyWindow(): LimitWindow {
  return {
    usedPercent: null,
    resetAfterSeconds: null,
    windowMinutes: null,
  };
}

function writeWindows(
  snapshot: UsageSnapshot,
  primary: LimitWindow,
  secondary: LimitWindow,
): UsageSnapshot {
  return {
    ...snapshot,
    primaryUsedPercent: primary.usedPercent,
    primaryResetAfterSeconds: primary.resetAfterSeconds,
    primaryWindowMinutes: primary.windowMinutes,
    secondaryUsedPercent: secondary.usedPercent,
    secondaryResetAfterSeconds: secondary.resetAfterSeconds,
    secondaryWindowMinutes: secondary.windowMinutes,
  };
}
