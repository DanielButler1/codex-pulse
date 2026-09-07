import type { AppSettings, CodexResetCreditsResult } from "./types";

export function getProjectionUsageSchedule(
  settings: Pick<AppSettings, "projectionResetSource" | "projectionResetAt" | "usageSchedule">,
  now: number,
): AppSettings["usageSchedule"] {
  return settings.projectionResetSource === "custom" &&
    settings.projectionResetAt != null &&
    settings.projectionResetAt > now
    ? []
    : settings.usageSchedule;
}

export function findNextAvailableManualResetAt(
  resetCredits: CodexResetCreditsResult | null,
  after: number,
): number | null {
  const candidates =
    resetCredits?.credits
      .filter(
        (credit) =>
          credit.status === "available" &&
          credit.expiresAt != null &&
          credit.expiresAt > after,
      )
      .map((credit) => credit.expiresAt as number)
      .sort((a, b) => a - b) ?? [];

  return candidates[0] ?? null;
}
