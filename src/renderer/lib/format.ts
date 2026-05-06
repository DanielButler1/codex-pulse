export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "Not reported";
  }
  return `${value.toFixed(1)}%`;
}

export function formatRemainingPercent(usedValue: number | null | undefined): string {
  if (usedValue == null || Number.isNaN(usedValue)) {
    return "Not reported";
  }
  return `${Math.max(0, 100 - usedValue).toFixed(1)}%`;
}

export function formatCountdown(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) {
    return "Not reported";
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) {
    return "Not reported";
  }
  return new Date(ms).toLocaleString();
}

export function formatTime(ms: number | null | undefined): string {
  if (!ms) {
    return "--:--";
  }
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(ms: number | null | undefined): string {
  if (!ms) {
    return "--";
  }
  return new Date(ms).toLocaleDateString();
}

export function formatBurnRate(value: number | null | undefined): string {
  if (value == null || value <= 0) {
    return "Need more data";
  }
  return `-${value.toFixed(1)}% remaining / hour`;
}
