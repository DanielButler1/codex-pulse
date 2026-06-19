import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Download, RefreshCw, Settings2 } from "lucide-react";
import { ModelUsageTable } from "./components/ModelUsageTable";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusBar } from "./components/StatusBar";
import {
  formatBurnRate,
  formatDate,
  formatDateTime,
  formatEvenPaceGap,
  formatTime,
} from "./lib/format";
import { codexPulseApi } from "./lib/ipc";
import { getProviderLogoPath } from "./lib/provider-icons";
import {
  PROVIDER_CATALOG,
  PROVIDER_IDS,
    type ProviderId,
} from "../../shared/provider-catalog";
import type {
  AppSettings,
  AppStatus,
  AppUpdateState,
  CodexResetCreditsResult,
  ModelUsageHeatmapData,
  ModelUsageRange,
  ModelUsageSummary,
  UsageSnapshot,
} from "./lib/types";

const DEFAULT_SETTINGS: AppSettings = {
  pollIntervalSeconds: 60,
  startAtLogin: true,
  notificationsEnabled: true,
  theme: "dark",
  limitDisplayMode: "remaining",
  subscriptionPlan: "free",
  subscriptionLastRenewalDate: "",
  providerSettings: Object.fromEntries(
    PROVIDER_IDS.map((providerId) => [
      providerId,
      {
        enabled: true,
        mode: "auto",
        apiBaseUrl: "",
        cliPath: "",
        accountId: "",
        workspacePath: "",
        headersJson: "",
        notes: "",
      },
    ]),
  ),
};
const MODEL_USAGE_BACKGROUND_REFRESH_MS = 5 * 60 * 1000;

type WeeklyWindowOption = {
  offset: number;
  label: string;
  start: number;
  end: number;
};

type PredictionTimelinePoint = {
  checkedAt: number;
  usedActual: number | null;
  usedProjected: number | null;
  usedEvenPace: number | null;
};

type PredictionTimeline = {
  periodStart: number | null;
  resetAt: number | null;
  hitAt: number | null;
  hitState: "hit" | "no_hit_before_reset" | "insufficient_data";
  usedNow: number | null;
  evenPaceUsedNow: number | null;
  evenPaceGap: number | null;
  projectedRate: number | null;
  points: PredictionTimelinePoint[];
};

type FiveHourLimitWarning = {
  hitAt: number;
  usedPercent: number;
};

export default function App() {
  const isDevBuild = import.meta.env.DEV;
  const [showSettings, setShowSettings] = useState(false);
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0);
  const [modelRange, setModelRange] = useState<ModelUsageRange>("24h");
  const [history, setHistory] = useState<UsageSnapshot[]>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsageSummary | null>(null);
  const [modelHeatmap, setModelHeatmap] = useState<ModelUsageHeatmapData | null>(null);
  const [resetCredits, setResetCredits] = useState<CodexResetCreditsResult | null>(null);
  const [modelHeatmapLoading, setModelHeatmapLoading] = useState(false);
  const [resetCreditsLoading, setResetCreditsLoading] = useState(false);
  const [latest, setLatest] = useState<UsageSnapshot | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [modelUsageLoading, setModelUsageLoading] = useState(false);
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(null);
  const lastModelUsageLoadAtRef = useRef(0);
  const modelUsageReferenceRef = useRef<UsageSnapshot | null>(null);
  const resetCreditsRef = useRef<CodexResetCreditsResult | null>(null);

  useEffect(() => {
    modelUsageReferenceRef.current = latest ?? history[history.length - 1] ?? null;
  }, [history, latest]);

  const load = useCallback(async () => {
    const [latestUsage, usageHistory, currentStatus] = await Promise.all([
      codexPulseApi.getLatestUsage(),
      codexPulseApi.getUsageHistory("30d"),
      codexPulseApi.getStatus(),
    ]);
    setLatest(latestUsage);
    setHistory(usageHistory);
    setStatus(currentStatus);
    if (currentStatus) {
      setSettings((prev) => ({
        ...prev,
        pollIntervalSeconds: currentStatus.pollIntervalSeconds,
      }));
    }
    return latestUsage;
  }, []);

  const loadSettings = useCallback(async () => {
    const currentSettings = await codexPulseApi.getSettings();
    setSettings(currentSettings);
  }, []);

  const loadUpdateState = useCallback(async () => {
    const state = await codexPulseApi.getUpdateState();
    setUpdateState(state);
  }, []);

  const loadResetCredits = useCallback(async (forceRefresh = false) => {
    const shouldShowLoading = forceRefresh || resetCreditsRef.current == null;
    if (shouldShowLoading) {
      setResetCreditsLoading(true);
    }
    try {
      const credits = await codexPulseApi.getCodexResetCredits(forceRefresh);
      resetCreditsRef.current = credits;
      setResetCredits(credits);
    } catch (error) {
      console.error("Failed to load Codex reset credits", error);
      const failedResult: CodexResetCreditsResult = {
        checkedAt: Date.now(),
        credits: [],
        availableCount: 0,
        totalEarnedCount: null,
        error: "Reset credits could not be loaded.",
      };
      resetCreditsRef.current = failedResult;
      setResetCredits(failedResult);
    } finally {
      if (shouldShowLoading) {
        setResetCreditsLoading(false);
      }
    }
  }, []);

  const loadModelUsage = useCallback(async (range: ModelUsageRange, referenceUsage: UsageSnapshot | null = modelUsageReferenceRef.current) => {
    setModelUsageLoading(true);
    try {
      const periodStart =
        range === "period"
          ? resolveRateLimitPeriodStart(referenceUsage)
          : range === "sub_period"
            ? resolveSubscriptionPeriodStart(settings.subscriptionLastRenewalDate)
            : null;
      const summary = await codexPulseApi.getModelUsage(range, periodStart);
      setModelUsage(summary);
      lastModelUsageLoadAtRef.current = Date.now();
    } catch (error) {
      console.error("Failed to load model usage", { range, error });
      setModelUsage(null);
    } finally {
      setModelUsageLoading(false);
    }
  }, [settings.subscriptionLastRenewalDate]);

  const loadModelHeatmap = useCallback(async () => {
    setModelHeatmapLoading(true);
    try {
      const heatmap = await codexPulseApi.getModelUsageHeatmap();
      setModelHeatmap(heatmap);
    } catch {
      setModelHeatmap(null);
    } finally {
      setModelHeatmapLoading(false);
    }
  }, []);

  const handleUpdateAction = useCallback(async () => {
    if (updateState?.status === "downloaded") {
      await codexPulseApi.installUpdate();
      return;
    }
    if (updateState?.status === "available") {
      await codexPulseApi.downloadUpdate();
      return;
    }
    await codexPulseApi.checkForUpdates();
  }, [updateState]);

  useEffect(() => {
    setLoading(true);
    void Promise.allSettled([load(), loadSettings(), loadUpdateState(), loadResetCredits()]).finally(() =>
      setLoading(false),
    );
  }, [load, loadResetCredits, loadSettings, loadUpdateState]);

  useEffect(() => {
    if (modelRange === "period") {
      const referenceUsage = modelUsageReferenceRef.current;
      if (!referenceUsage) {
        return;
      }
      void loadModelUsage("period", referenceUsage);
      return;
    }
    if (modelRange === "sub_period") {
      if (!resolveSubscriptionPeriodStart(settings.subscriptionLastRenewalDate)) {
        setModelUsage(null);
        return;
      }
      void loadModelUsage("sub_period");
      return;
    }
    void loadModelUsage(modelRange);
  }, [loadModelUsage, modelRange, settings.subscriptionLastRenewalDate]);

  useEffect(() => {
    if (modelRange !== "period" && modelRange !== "sub_period") {
      return;
    }
    if (
      modelUsage != null &&
      Date.now() - lastModelUsageLoadAtRef.current < MODEL_USAGE_BACKGROUND_REFRESH_MS
    ) {
      return;
    }
    if (modelRange === "period") {
      const referenceUsage = modelUsageReferenceRef.current;
      if (!referenceUsage) {
        return;
      }
      void loadModelUsage("period", referenceUsage);
      return;
    }
    if (!resolveSubscriptionPeriodStart(settings.subscriptionLastRenewalDate)) {
      return;
    }
    void loadModelUsage("sub_period");
  }, [loadModelUsage, modelRange, modelUsage, settings.subscriptionLastRenewalDate]);

  useEffect(() => {
    void loadModelHeatmap();
  }, [loadModelHeatmap]);

  useEffect(() => {
    const interval = setInterval(() => {
      void load();
      void loadSettings();
      void loadUpdateState();
      void loadResetCredits();
    }, 15_000);
    const unsubscribe = codexPulseApi.subscribe(() => {
      void load();
      void loadSettings();
      void loadUpdateState();
      void loadResetCredits();
      if (Date.now() - lastModelUsageLoadAtRef.current >= MODEL_USAGE_BACKGROUND_REFRESH_MS) {
        void loadModelUsage(modelRange);
      }
    });
    return () => {
      clearInterval(interval);
      unsubscribe?.();
    };
  }, [
    load,
    loadModelUsage,
    loadResetCredits,
    loadSettings,
    loadUpdateState,
    modelRange,
  ]);

  useEffect(() => {
    const unsubscribe = codexPulseApi.subscribeToUpdateState(() => {
      void loadUpdateState();
    });
    return () => {
      unsubscribe?.();
    };
  }, [loadUpdateState]);

  const weeklyWindows = useMemo(
    () => buildWeeklyWindowOptions(latest, history),
    [history, latest],
  );

  useEffect(() => {
    if (!weeklyWindows.some((window) => window.offset === selectedWeekOffset)) {
      setSelectedWeekOffset(0);
    }
  }, [selectedWeekOffset, weeklyWindows]);

  const selectedWindow =
    weeklyWindows.find((window) => window.offset === selectedWeekOffset) ??
    weeklyWindows[0] ??
    null;

  const windowHistory = useMemo(() => {
    if (!selectedWindow) {
      return history;
    }
    return history.filter(
      (snapshot) =>
        snapshot.checkedAt >= selectedWindow.start && snapshot.checkedAt < selectedWindow.end,
    );
  }, [history, selectedWindow]);

  const onRefreshNow = useCallback(async () => {
    await codexPulseApi.refreshNow();
    const latestUsage = await load();
    await Promise.all([
      loadModelHeatmap(),
      loadResetCredits(true),
      modelRange === "period"
        ? loadModelUsage("period", latestUsage ?? modelUsageReferenceRef.current)
        : loadModelUsage(modelRange),
    ]);
  }, [load, loadModelHeatmap, loadModelUsage, loadResetCredits, modelRange]);

  const onModelRangeChange = useCallback(
    (range: ModelUsageRange) => {
      setModelRange(range);
    },
    [],
  );

  const onOpenSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const onSettingsChange = useCallback(
    async (partial: Partial<AppSettings>) => {
      const merged = { ...settings, ...partial };
      setSettings(merged);
      try {
        await codexPulseApi.updateSettings(partial);
      } catch (error) {
        console.error("Failed to update settings", error);
        setSettings(settings);
      }
    },
    [settings],
  );

  const authMessage = useMemo(() => {
    if (!status) {
      return "Waiting for status...";
    }
    if (status.lastError && status.lastSuccessAt) {
      return `Usage check failed. Last successful update: ${new Date(status.lastSuccessAt).toLocaleTimeString()}`;
    }
    if (status.authMessage) {
      return status.authMessage;
    }
    return "Auth status healthy.";
  }, [status]);
  const selectedProvider =
    PROVIDER_CATALOG.find((provider) => provider.id === "codex") ?? PROVIDER_CATALOG[0];
  const activeSnapshot = latest;
  const activeAuthMessage = authMessage;

  const primaryRemaining =
    activeSnapshot?.primaryUsedPercent == null ? null : Math.max(0, 100 - activeSnapshot.primaryUsedPercent);
  const secondaryRemaining =
    activeSnapshot?.secondaryUsedPercent == null ? null : Math.max(0, 100 - activeSnapshot.secondaryUsedPercent);
  const weeklyResetAt =
    activeSnapshot?.checkedAt != null && activeSnapshot.secondaryResetAfterSeconds != null
      ? activeSnapshot.checkedAt + activeSnapshot.secondaryResetAfterSeconds * 1000
      : null;
  const primaryResetAt =
    activeSnapshot?.checkedAt != null && activeSnapshot.primaryResetAfterSeconds != null
      ? activeSnapshot.checkedAt + activeSnapshot.primaryResetAfterSeconds * 1000
      : null;
  const fiveHourLimitWarning = useMemo(
    () => buildFiveHourLimitWarning(activeSnapshot, primaryResetAt),
    [activeSnapshot, primaryResetAt],
  );
  const effectiveBurnRate = useMemo(
    () => resolveBurnRate(latest, status?.burnRatePercentPerHour ?? null),
    [latest, status?.burnRatePercentPerHour],
  );

  const predictionTimeline = useMemo(
    () =>
      buildPredictionTimeline({
        history,
        latest,
        weeklyResetAt,
        burnRatePercentPerHour: effectiveBurnRate,
      }),
    [effectiveBurnRate, history, latest, weeklyResetAt],
  );

  const estimatedTimeText =
    predictionTimeline.hitState === "hit"
      ? formatTime(predictionTimeline.hitAt)
      : predictionTimeline.hitState === "no_hit_before_reset"
        ? "Won't hit"
        : "Need more data";
  const estimatedDateText =
    predictionTimeline.hitState === "hit"
      ? formatDate(predictionTimeline.hitAt)
      : predictionTimeline.hitState === "no_hit_before_reset"
        ? "Before weekly reset"
        : "";
  const hitLabelLeftPercent = getHitLabelLeftPercent(
    predictionTimeline.periodStart,
    predictionTimeline.hitAt,
    predictionTimeline.resetAt,
  );
  const evenPaceGapText = formatEvenPaceGap(predictionTimeline.evenPaceGap);

  return (
    <div className="min-h-screen bg-black text-neutral-100">
      <aside className="fixed inset-y-0 left-0 flex w-64 flex-col border-r border-neutral-800 bg-neutral-900 px-3 py-4">
        <div className="px-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Codex Pulse</h1>
            {isDevBuild ? (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200">
                Dev
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-neutral-400">Local usage monitor for Codex.</p>
        </div>
        <div className="mt-4 flex-1 px-2">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Dashboard</p>
            <p className="mt-2 text-sm font-medium text-neutral-100">Codex</p>
            <p className="mt-1 text-xs leading-5 text-neutral-400">
              Weekly limits, projection, rollout usage, and subscription period tracking.
            </p>
          </div>
        </div>
        <div className="space-y-2 border-t border-neutral-800 pt-3">
          {updateState?.status === "available" ||
          updateState?.status === "downloading" ||
          updateState?.status === "downloaded" ? (
            <button
              type="button"
              onClick={() => {
                void handleUpdateAction();
              }}
              disabled={updateState.status === "downloading"}
              className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-left text-sm text-emerald-100 transition hover:border-emerald-400/50 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-80"
            >
              <span className="flex items-start gap-2">
                <Download className="mt-0.5 h-4 w-4" />
                <span className="min-w-0">
                  <span className="block font-medium">
                    {updateState.status === "downloaded"
                      ? "Restart to install update"
                      : updateState.status === "downloading"
                        ? `Downloading update${typeof updateState.progress === "number" ? ` ${Math.round(updateState.progress)}%` : ""}`
                        : "Update available"}
                  </span>
                  <span className="mt-0.5 block text-xs text-emerald-100/75">
                    {updateState.version ? `Version ${updateState.version}` : "Ready to install"}
                  </span>
                </span>
              </span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setShowSettings((current) => !current);
            }}
            className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
              showSettings
                ? "border-neutral-600 bg-neutral-800 text-white"
                : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-600"
            }`}
          >
            <span className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              <span>Settings</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowSettings(false);
              void onRefreshNow();
            }}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-left text-sm text-neutral-300 transition hover:border-neutral-600"
          >
            <span className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              <span>Refresh now</span>
            </span>
          </button>
        </div>
      </aside>

      <main className="custom-scrollbar ml-64 h-screen overflow-y-auto px-5 py-5">
        <div className="flex flex-col gap-5">
          {loading ? (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-8 text-center text-neutral-300">
              Loading usage data...
            </div>
          ) : showSettings ? (
            <SettingsPanel
              settings={settings}
              onChange={onSettingsChange}
            />
          ) : (
            <>
              <section>
                <div className="mb-2 flex items-center gap-3">
                  <ProviderLogo providerId="codex" label="Codex" large />
                  <h2 className="text-2xl font-semibold">Codex</h2>
                </div>
                <p className="text-sm text-neutral-400">
                  Local Codex usage tracking from app-server, rollout logs, and rate-limit snapshots.
                </p>
              </section>

              <section>
                <h2 className="mb-3 text-2xl font-semibold">Usage</h2>
                <ProviderUsagePanel
                  provider={selectedProvider}
                  snapshot={activeSnapshot}
                  primaryRemaining={primaryRemaining}
                  secondaryRemaining={secondaryRemaining}
                  primaryResetAt={primaryResetAt}
                  secondaryResetAt={weeklyResetAt}
                  fiveHourLimitWarning={fiveHourLimitWarning}
                  displayMode={settings.limitDisplayMode}
                  loading={false}
                />
              </section>

              <>
                  <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                    <h3 className="text-xl font-semibold">Predicted limit hit</h3>
                    <p className="mt-1 text-sm text-neutral-400">
                      At your current usage rate, you&apos;ll hit your weekly limit
                    </p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-4">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-neutral-500">Estimated hit</p>
                        <p className="mt-1 text-3xl font-semibold">{estimatedTimeText}</p>
                        {estimatedDateText ? <p className="mt-1 text-base text-neutral-400">{estimatedDateText}</p> : null}
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-neutral-500">Current pace</p>
                        <p className="mt-1 text-sm text-neutral-300">{formatBurnRate(predictionTimeline.projectedRate)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-neutral-500">Lead time</p>
                        <p className="mt-1 text-sm text-neutral-300">
                          {formatLeadTime(
                            predictionTimeline.hitAt,
                            predictionTimeline.resetAt,
                            predictionTimeline.hitState,
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-neutral-500">Even pace gap</p>
                        <p className="mt-1 text-sm text-neutral-300">{evenPaceGapText}</p>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={predictionTimeline.points} margin={{ top: 8, right: 0, left: 0, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                            <XAxis
                              type="number"
                              dataKey="checkedAt"
                              domain={[
                                predictionTimeline.periodStart ?? "auto",
                                predictionTimeline.resetAt ?? "auto",
                              ]}
                              stroke="#a3a3a3"
                              tickLine={false}
                              axisLine={false}
                              tick={false}
                            />
                            <YAxis
                              domain={[0, 100]}
                              stroke="#a3a3a3"
                              tickLine={false}
                              axisLine={false}
                              tick={false}
                              width={0}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#171717",
                                border: "1px solid #404040",
                                borderRadius: "0.75rem",
                                color: "#f5f5f5",
                              }}
                              formatter={(value: unknown) =>
                                typeof value === "number" ? `${value.toFixed(1)}% used` : String(value ?? "")
                              }
                              labelFormatter={(value: unknown) =>
                                new Date(typeof value === "number" ? value : Number(value)).toLocaleString()
                              }
                            />
                            {predictionTimeline.hitAt ? (
                              <ReferenceLine
                                x={predictionTimeline.hitAt}
                                stroke="#c4b5fd"
                                strokeDasharray="3 3"
                              />
                            ) : null}
                            {predictionTimeline.hitAt ? (
                              <ReferenceDot
                                x={predictionTimeline.hitAt}
                                y={100}
                                r={6}
                                fill="#0a0a0a"
                                stroke="#c4b5fd"
                                strokeWidth={3}
                              />
                            ) : null}
                            <Area
                              type="monotone"
                              dataKey="usedActual"
                              stroke="#22c55e"
                              fill="#22c55e"
                              fillOpacity={0.08}
                              strokeWidth={2}
                              connectNulls
                              name="Actual used"
                            />
                            <Area
                              type="linear"
                              dataKey="usedEvenPace"
                              stroke="#ef4444"
                              strokeDasharray="4 4"
                              fill="transparent"
                              fillOpacity={0}
                              strokeWidth={2}
                              connectNulls
                              name="Even pace to 100%"
                            />
                            <Area
                              type="linear"
                              dataKey="usedProjected"
                              stroke="#c4b5fd"
                              strokeDasharray="5 4"
                              fill="#c4b5fd"
                              fillOpacity={0.06}
                              strokeWidth={2}
                              connectNulls={false}
                              name="Projected used"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="mt-2 text-xs text-neutral-500">
                        Red dashed line shows the even pace needed to use 100% exactly at reset.
                      </p>
                      <div className="relative mt-2 min-h-[3rem] text-xs text-neutral-400">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-neutral-200">
                              {predictionTimeline.periodStart ? formatDate(predictionTimeline.periodStart) : "--"}
                            </p>
                            <p>Period started</p>
                          </div>
                          <div className="text-right">
                            <p className="text-neutral-200">
                              {predictionTimeline.resetAt ? formatDate(predictionTimeline.resetAt) : "--"}
                            </p>
                            <p>Limit resets</p>
                          </div>
                        </div>
                        <div
                          className="absolute top-0 text-center"
                          style={{ left: `${hitLabelLeftPercent}%`, transform: "translateX(-50%)" }}
                        >
                          <p className="text-neutral-200">
                            {predictionTimeline.hitState === "hit"
                              ? `${formatDate(predictionTimeline.hitAt)} ${formatTime(predictionTimeline.hitAt)}`
                              : predictionTimeline.hitState === "no_hit_before_reset"
                                ? "No hit expected"
                                : "--"}
                          </p>
                          <p>Limit hit</p>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xl font-semibold">Usage over time</h3>
                      <select
                        className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200"
                        value={selectedWeekOffset}
                        onChange={(event) => setSelectedWeekOffset(Number(event.target.value))}
                      >
                        {weeklyWindows.map((window) => (
                          <option key={window.offset} value={window.offset}>
                            {window.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <UsageSparkline data={windowHistory} />
                  </section>

                  <ModelUsageTable
                    summary={modelUsage}
                    heatmap={modelHeatmap}
                    heatmapLoading={modelHeatmapLoading}
                    settings={settings}
                    range={modelRange}
                    loading={modelUsageLoading}
                    onRangeChange={onModelRangeChange}
                    onOpenSettings={onOpenSettings}
                  />

                  <ResetCreditsSection
                    resetCredits={resetCredits}
                    loading={resetCreditsLoading}
                  />
              </>
            </>
          )}

          <StatusBar
            authMessage={activeAuthMessage}
            pollIntervalSeconds={settings.pollIntervalSeconds}
            onRefresh={onRefreshNow}
          />
        </div>

      </main>
    </div>
  );
}

function LimitCard({
  title,
  remaining,
  resetAt,
  warning,
  displayMode,
}: {
  title: string;
  remaining: number | null;
  resetAt: number | null;
  warning?: FiveHourLimitWarning | null;
  displayMode: AppSettings["limitDisplayMode"];
}) {
  const used = remaining == null ? null : Math.max(0, 100 - remaining);
  const displayPercent = displayMode === "used" ? used : remaining;
  const displayLabel = displayMode === "used" ? "used" : "remaining";
  const remainingClamped = remaining != null ? Math.max(0, Math.min(100, remaining)) : null;
  const usedClamped = used != null ? Math.max(0, Math.min(100, used)) : null;
  const progressWidth = displayMode === "used" ? usedClamped : remainingClamped;
  const warningText =
    warning == null
      ? null
      : warning.usedPercent >= 100
        ? `Hit at ${formatTime(warning.hitAt)}`
        : `Hits at ${formatTime(warning.hitAt)}`;
  return (
    <article className="h-full rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex min-h-5 items-start justify-between gap-3">
        <p className="text-sm font-medium text-neutral-300">{title}</p>
        {warning && warningText ? (
          <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-amber-300/90">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{warningText}</span>
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-4xl font-semibold leading-none">
        {displayPercent != null ? `${displayPercent.toFixed(0)}%` : "--"}
        <span className="ml-2 text-2xl font-normal text-neutral-300">{displayLabel}</span>
      </p>
      <div className="mt-5 h-2.5 rounded-full bg-neutral-200/20">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${progressWidth ?? 0}%` }}
        />
      </div>
      <p className="mt-3 text-sm text-neutral-400">
        Resets {resetAt ? formatResetLabel(resetAt) : "Not reported"}
      </p>
    </article>
  );
}

function StatCard({
  title,
  value,
  subtext,
}: {
  title: string;
  value: string;
  subtext?: string;
}) {
  return (
    <article className="h-full rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
      <p className="text-sm font-medium text-neutral-300">{title}</p>
      <p className="mt-2 text-3xl font-semibold leading-tight">{value}</p>
      {subtext ? <p className="mt-2 text-sm text-neutral-400">{subtext}</p> : null}
    </article>
  );
}

function UsageLoadingBanner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3">
      <div>
        <p className="text-sm font-medium text-neutral-200">{label}</p>
        <p className="mt-1 text-xs text-neutral-500">Refreshing cached data in the background...</p>
      </div>
      <div className="h-2 w-24 rounded-full bg-neutral-800">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-500" />
      </div>
    </div>
  );
}

function ProviderUsagePanel({
  provider,
  snapshot,
  primaryRemaining,
  secondaryRemaining,
  primaryResetAt,
  secondaryResetAt,
  fiveHourLimitWarning,
  displayMode,
  loading,
}: {
  provider: (typeof PROVIDER_CATALOG)[number];
  snapshot: UsageSnapshot | null;
  primaryRemaining: number | null;
  secondaryRemaining: number | null;
  primaryResetAt: number | null;
  secondaryResetAt: number | null;
  fiveHourLimitWarning: FiveHourLimitWarning | null;
  displayMode: AppSettings["limitDisplayMode"];
  loading: boolean;
}) {
  const dashboard = provider.dashboard;
  const balanceValue =
    snapshot?.creditsBalance != null
      ? formatCredits(snapshot.creditsBalance)
      : snapshot?.planType ?? "Not reported";
  const balanceSubtext =
    snapshot?.creditsGranted != null || snapshot?.creditsUsed != null
      ? [
          snapshot.creditsUsed != null ? `Used ${formatCredits(snapshot.creditsUsed)}` : null,
          snapshot.creditsGranted != null ? `Granted ${formatCredits(snapshot.creditsGranted)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : dashboard.summary;

  return (
    <div className="space-y-3">
      {loading ? <UsageLoadingBanner label={`${provider.label} usage`} /> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <LimitCard
          title={dashboard.primaryLabel}
          remaining={primaryRemaining}
          resetAt={primaryResetAt}
          warning={fiveHourLimitWarning}
          displayMode={displayMode}
        />
        <LimitCard
          title={dashboard.secondaryLabel ?? "Secondary"}
          remaining={secondaryRemaining}
          resetAt={secondaryResetAt}
          displayMode={displayMode}
        />
        <StatCard
          title={dashboard.balanceLabel ?? "Balance"}
          value={balanceValue}
          subtext={balanceSubtext}
        />
      </div>
    </div>
  );
}

function ResetCreditsSection({
  resetCredits,
  loading,
}: {
  resetCredits: CodexResetCreditsResult | null;
  loading: boolean;
}) {
  const availableCredits =
    resetCredits?.credits.filter((credit) => credit.status === "available") ?? [];
  const visibleCount = resetCredits?.availableCount ?? availableCredits.length;
  const countLabel = `${visibleCount} ${visibleCount === 1 ? "reset" : "resets"} available`;

  return (
    <section className="space-y-3 pb-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">Resets</h3>
          <p className="mt-1 text-sm text-neutral-400">
            {loading && !resetCredits ? "Loading reset credits..." : countLabel}
          </p>
        </div>
        {resetCredits?.checkedAt ? (
          <p className="text-xs text-neutral-500">Checked {formatDateTime(resetCredits.checkedAt)}</p>
        ) : null}
      </div>

      {resetCredits?.error ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
          {resetCredits.error}
        </div>
      ) : availableCredits.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {availableCredits.map((credit, index) => (
            <ResetCreditCard
              key={credit.id}
              credit={credit}
              index={index}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4 text-sm text-neutral-400">
          No available reset credits reported.
        </div>
      )}
    </section>
  );
}

function ResetCreditCard({
  credit,
  index,
}: {
  credit: CodexResetCreditsResult["credits"][number];
  index: number;
}) {
  return (
    <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Reset {index + 1}
          </p>
          <p className="mt-1 text-sm font-medium text-neutral-200">
            {credit.title ?? "Rate limit reset"}
          </p>
        </div>
        <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
          Available
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">Expires</dt>
          <dd className="mt-1 font-semibold text-neutral-100">
            {formatResetCreditDateTime(credit.expiresAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">Granted</dt>
          <dd className="mt-1 text-neutral-300">{formatResetCreditDateTime(credit.grantedAt)}</dd>
        </div>
      </dl>
    </article>
  );
}

function resolveRateLimitPeriodStart(latest: UsageSnapshot | null): number | null {
  if (!latest) {
    return null;
  }
  const windowMinutes = latest.secondaryWindowMinutes ?? latest.primaryWindowMinutes ?? null;
  const resetAfterSeconds = latest.secondaryResetAfterSeconds ?? latest.primaryResetAfterSeconds ?? null;
  if (windowMinutes == null || resetAfterSeconds == null) {
    return null;
  }
  const windowMs = windowMinutes * 60 * 1000;
  const remainingMs = Math.max(0, resetAfterSeconds * 1000);
  return Math.max(0, latest.checkedAt - (windowMs - remainingMs));
}

function resolveSubscriptionPeriodStart(renewalDate: string): number | null {
  const period = resolveSubscriptionPeriod(renewalDate);
  return period?.start ?? null;
}

function resolveSubscriptionPeriod(
  renewalDate: string,
): { start: number; end: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(renewalDate)) {
    return null;
  }
  const [yearText, monthText, dayText] = renewalDate.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
    return null;
  }

  const seed = new Date(year, monthIndex, day);
  seed.setHours(0, 0, 0, 0);
  if (Number.isNaN(seed.getTime())) {
    return null;
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  let currentStart = seed;
  let nextStart = addMonthsClamped(seed, 1);
  while (nextStart.getTime() <= now.getTime()) {
    currentStart = nextStart;
    nextStart = addMonthsClamped(currentStart, 1);
  }

  return {
    start: currentStart.getTime(),
    end: nextStart.getTime(),
  };
}

function addMonthsClamped(date: Date, months: number): Date {
  const baseYear = date.getFullYear();
  const baseMonth = date.getMonth() + months;
  const baseDay = date.getDate();
  const targetYear = baseYear + Math.floor(baseMonth / 12);
  const targetMonth = ((baseMonth % 12) + 12) % 12;
  const maxDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  const next = new Date(targetYear, targetMonth, Math.min(baseDay, maxDay));
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatCredits(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "Not reported";
  }
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(Math.max(0, value));
  return `${formatted} credits`;
}

function formatResetLabel(value: number): string {
  return new Date(value).toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatResetCreditDateTime(value: number | null): string {
  if (value == null) {
    return "Not reported";
  }
  return new Date(value).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildFiveHourLimitWarning(
  snapshot: UsageSnapshot | null,
  resetAt: number | null,
): FiveHourLimitWarning | null {
  if (!snapshot || resetAt == null || snapshot.primaryUsedPercent == null || snapshot.checkedAt == null) {
    return null;
  }

  const windowMinutes = snapshot.primaryWindowMinutes ?? 5 * 60;
  if (Math.abs(windowMinutes - 5 * 60) > 5 || resetAt <= snapshot.checkedAt) {
    return null;
  }

  const usedPercent = clampPct(snapshot.primaryUsedPercent);
  if (usedPercent <= 0) {
    return null;
  }

  const windowStart = resetAt - windowMinutes * 60 * 1000;
  const elapsedHours = Math.max((snapshot.checkedAt - windowStart) / (1000 * 60 * 60), 1 / 60);
  const projectedRate = usedPercent / elapsedHours;
  if (!Number.isFinite(projectedRate) || projectedRate <= 0) {
    return null;
  }

  const hitAt =
    usedPercent >= 100
      ? snapshot.checkedAt
      : snapshot.checkedAt + ((100 - usedPercent) / projectedRate) * 60 * 60 * 1000;

  if (hitAt >= resetAt) {
    return null;
  }

  return {
    hitAt,
    usedPercent,
  };
}

function ProviderLogo({
  providerId,
  label,
  large = false,
}: {
  providerId: ProviderId;
  label: string;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sizeClass = large ? "h-7 w-7" : "h-5 w-5";
  const src = `${getProviderLogoPath(providerId)}?v=${attempt}`;

  useEffect(() => {
    setFailed(false);
    setAttempt(0);
  }, [providerId]);

  if (failed) {
    return (
      <button
        type="button"
        className={`${sizeClass} inline-flex items-center justify-center rounded-md border border-neutral-700 bg-neutral-800 text-[11px] font-semibold text-neutral-200`}
        title="Retry logo"
        onClick={() => {
          setFailed(false);
          setAttempt((value) => value + 1);
        }}
      >
        {label.slice(0, 1).toUpperCase()}
      </button>
    );
  }

  return (
    <span className={`${sizeClass} inline-flex items-center justify-center rounded-md border border-neutral-700 bg-neutral-800 p-1`}>
      <img
        src={src}
        alt={`${label} logo`}
        className="h-full w-full object-contain"
        loading="lazy"
        onError={() => setFailed(true)}
        onLoad={() => setFailed(false)}
      />
    </span>
  );
}

function UsageSparkline({ data }: { data: UsageSnapshot[] }) {
  const chartData = data.map((snapshot) => ({
    checkedAt: snapshot.checkedAt,
    used5h: snapshot.primaryUsedPercent ?? null,
    usedWeekly: snapshot.secondaryUsedPercent ?? null,
  }));
  const start = chartData.length > 0 ? chartData[0].checkedAt : Date.now();
  const end = chartData.length > 0 ? chartData[chartData.length - 1].checkedAt : start;
  const spansMultipleDays = !sameLocalDay(start, end);

  return (
    <div className="h-64 rounded-xl border border-neutral-800 bg-neutral-900 p-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
          <XAxis
            dataKey="checkedAt"
            stroke="#a3a3a3"
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            tick={{ fill: "#a3a3a3", fontSize: 12 }}
            tickFormatter={(value: number) =>
              spansMultipleDays
                ? new Date(value).toLocaleDateString([], { day: "2-digit", month: "short" })
                : new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            stroke="#a3a3a3"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#a3a3a3", fontSize: 12 }}
            tickFormatter={(v: number) => `${Math.round(v)}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#171717",
              border: "1px solid #404040",
              borderRadius: "0.75rem",
              color: "#f5f5f5",
            }}
            formatter={(value: unknown) =>
              typeof value === "number" ? `${value.toFixed(1)}% used` : String(value ?? "")
            }
            labelFormatter={(value: unknown) =>
              formatDateTime(typeof value === "number" ? value : Number(value))
            }
          />
          <Legend wrapperStyle={{ color: "#d4d4d4", fontSize: "12px" }} />
          <Area
            type="monotone"
            dataKey="used5h"
            stroke="#22c55e"
            fill="#22c55e"
            fillOpacity={0.1}
            strokeWidth={2}
            name="5h used"
          />
          <Area
            type="monotone"
            dataKey="usedWeekly"
            stroke="#ef4444"
            fill="#ef4444"
            fillOpacity={0.08}
            strokeWidth={2}
            name="Weekly used"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function buildPredictionTimeline(params: {
  history: UsageSnapshot[];
  latest: UsageSnapshot | null;
  weeklyResetAt: number | null;
  burnRatePercentPerHour: number | null;
}): PredictionTimeline {
  const { history, latest, weeklyResetAt, burnRatePercentPerHour } = params;
  if (!latest || weeklyResetAt == null || latest.secondaryUsedPercent == null) {
    return {
      periodStart: null,
      resetAt: null,
      hitAt: null,
      hitState: "insufficient_data",
      usedNow: null,
      evenPaceUsedNow: null,
      evenPaceGap: null,
      projectedRate: null,
      points: [],
    };
  }

  const usedNow = clampPct(latest.secondaryUsedPercent);
  const periodMinutes = latest.secondaryWindowMinutes ?? 7 * 24 * 60;
  const periodStart = weeklyResetAt - periodMinutes * 60 * 1000;
  const evenPaceUsedNow = calculateEvenPaceUsed(latest.checkedAt, periodStart, weeklyResetAt);
  const evenPaceGap = usedNow - evenPaceUsedNow;

  const observed = history
    .filter(
      (snapshot) =>
        snapshot.secondaryUsedPercent != null &&
        snapshot.checkedAt >= periodStart &&
        snapshot.checkedAt <= latest.checkedAt,
    )
    .sort((a, b) => a.checkedAt - b.checkedAt);

  const map = new Map<number, PredictionTimelinePoint>();
  const addPoint = (checkedAt: number, usedActual: number | null, usedProjected: number | null) => {
    const existing = map.get(checkedAt);
    if (existing) {
      map.set(checkedAt, {
        checkedAt,
        usedActual: usedActual ?? existing.usedActual,
        usedProjected: usedProjected ?? existing.usedProjected,
        usedEvenPace: existing.usedEvenPace,
      });
      return;
    }
    map.set(checkedAt, { checkedAt, usedActual, usedProjected, usedEvenPace: null });
  };

  // Assume the weekly period started near 0% when early telemetry is sparse.
  // This avoids underestimating pace at the beginning of a reset window.
  const periodStartUsed = 0;
  addPoint(periodStart, periodStartUsed, null);

  for (const snapshot of observed) {
    addPoint(snapshot.checkedAt, clampPct(snapshot.secondaryUsedPercent ?? 0), null);
  }
  addPoint(latest.checkedAt, usedNow, null);

  const projectedRate = calculateBlendedProjectionRate({
    observed,
    periodStart,
    periodStartUsed,
    usedNow,
    latestCheckedAt: latest.checkedAt,
    backendRate: burnRatePercentPerHour,
  });

  addPoint(latest.checkedAt, null, usedNow);
  let hitAt: number | null = null;
  let hitState: PredictionTimeline["hitState"] = "insufficient_data";
  const projectedHitAt = estimateHitAt(latest.checkedAt, usedNow, projectedRate);
  if (
    projectedHitAt != null &&
    projectedHitAt > latest.checkedAt &&
    projectedHitAt < weeklyResetAt
  ) {
    hitAt = projectedHitAt;
    hitState = "hit";
    addProjectedCurve({
      addPoint,
      startAt: latest.checkedAt,
      endAt: hitAt,
      startUsed: usedNow,
      endUsed: 100,
      steps: 12,
      easing: "linear",
    });
    addPoint(weeklyResetAt, null, null);
  } else {
    if (projectedRate != null && projectedRate > 0) {
      hitState = "no_hit_before_reset";
    }
    const projectedAtReset =
      projectedRate != null && projectedRate > 0
        ? clampPct(usedNow + projectedRate * ((weeklyResetAt - latest.checkedAt) / (1000 * 60 * 60)))
        : usedNow;
    addProjectedCurve({
      addPoint,
      startAt: latest.checkedAt,
      endAt: weeklyResetAt,
      startUsed: usedNow,
      endUsed: projectedAtReset,
      steps: 10,
      easing: "linear",
    });
  }

  return {
    periodStart,
    resetAt: weeklyResetAt,
    hitAt,
    hitState,
    usedNow,
    evenPaceUsedNow,
    evenPaceGap,
    projectedRate,
    points: [...map.values()]
      .sort((a, b) => a.checkedAt - b.checkedAt)
      .map((point) => ({
        ...point,
        usedEvenPace: calculateEvenPaceUsed(point.checkedAt, periodStart, weeklyResetAt),
      })),
  };
}

function resolveBurnRate(latest: UsageSnapshot | null, preferred: number | null): number | null {
  if (
    !latest ||
    latest.secondaryUsedPercent == null ||
    latest.secondaryResetAfterSeconds == null ||
    latest.checkedAt == null
  ) {
    return null;
  }
  const used = Math.max(0, Math.min(100, latest.secondaryUsedPercent));
  if (used <= 0) {
    return null;
  }

  const weeklyResetAt = latest.checkedAt + latest.secondaryResetAfterSeconds * 1000;
  const windowMinutes = latest.secondaryWindowMinutes ?? 7 * 24 * 60;
  const windowStart = weeklyResetAt - windowMinutes * 60 * 1000;
  const elapsedHours = Math.max((latest.checkedAt - windowStart) / (1000 * 60 * 60), 1 / 60);
  const baseline = elapsedHours > 0 ? used / elapsedHours : null;

  if (preferred != null && preferred > 0) {
    if (baseline != null && baseline > 0) {
      // Keep scheduler-provided rate, but prevent unrealistic underestimates.
      return Math.max(preferred, baseline * 0.65);
    }
    return preferred;
  }

  return baseline;
}

function calculateBlendedProjectionRate(params: {
  observed: UsageSnapshot[];
  periodStart: number;
  periodStartUsed: number;
  usedNow: number;
  latestCheckedAt: number;
  backendRate: number | null;
}): number | null {
  const { observed, periodStart, periodStartUsed, usedNow, latestCheckedAt, backendRate } = params;

  const elapsedHours = Math.max((latestCheckedAt - periodStart) / (1000 * 60 * 60), 1 / 60);
  const periodRate = clampMin((usedNow - periodStartUsed) / elapsedHours, 0);
  const sixHourRate = calculateWindowObservedRate(observed, latestCheckedAt, 6 * 60 * 60 * 1000);
  const twelveHourRate = calculateWindowObservedRate(observed, latestCheckedAt, 12 * 60 * 60 * 1000);
  const twentyFourHourRate = calculateWindowObservedRate(observed, latestCheckedAt, 24 * 60 * 60 * 1000);
  const recentRate = calculateRecentObservedRate(observed);
  const sampleCount = observed.filter((snapshot) => snapshot.secondaryUsedPercent != null).length;
  const baselineRate = weightedAverageRate([
    { rate: twentyFourHourRate, weight: 0.45 },
    { rate: twelveHourRate, weight: 0.25 },
    { rate: periodRate, weight: 0.2 },
    { rate: backendRate, weight: 0.1 },
  ]);
  const shortWindowRate = weightedAverageRate([
    { rate: sixHourRate, weight: 0.5 },
    { rate: twelveHourRate, weight: 0.3 },
    { rate: twentyFourHourRate, weight: 0.15 },
    { rate: recentRate, weight: 0.05 },
  ]);
  const shortWindowPace = Math.max(
    shortWindowRate ?? 0,
    sixHourRate ?? 0,
    twelveHourRate ?? 0,
    twentyFourHourRate ?? 0,
    recentRate ?? 0,
  );
  const effectiveAnchor = baselineRate ?? periodRate ?? backendRate ?? null;

  if (shortWindowRate == null) {
    return effectiveAnchor != null ? clampMin(effectiveAnchor, 0) : null;
  }

  const windowSignalCount = [sixHourRate, twelveHourRate, twentyFourHourRate, recentRate].filter(
    (rate) => rate != null && Number.isFinite(rate),
  ).length;
  const recentEvidence = Math.min(windowSignalCount / 4, 1) * Math.min(sampleCount / 6, 1);
  const elapsedEvidence = Math.min(elapsedHours / 24, 1);
  const divergence =
    effectiveAnchor != null && effectiveAnchor > 0
      ? Math.min(Math.abs(shortWindowRate - effectiveAnchor) / effectiveAnchor, 1.5) / 1.5
      : shortWindowRate > 0
        ? 1
        : 0;

  const trendingUp = effectiveAnchor == null || shortWindowRate >= effectiveAnchor;
  const recentWeightBase = trendingUp
    ? 0.62 + recentEvidence * 0.14 + elapsedEvidence * 0.08 + divergence * 0.08
    : 0.48 + recentEvidence * 0.1 + elapsedEvidence * 0.06 + divergence * 0.06;
  const recentWeight = Math.max(trendingUp ? 0.65 : 0.5, Math.min(trendingUp ? 0.9 : 0.72, recentWeightBase));

  const anchoredRate =
    effectiveAnchor == null
      ? shortWindowRate
      : effectiveAnchor * (1 - recentWeight) + shortWindowRate * recentWeight;

  const floorRate =
    effectiveAnchor != null
      ? trendingUp
        ? Math.max(shortWindowPace * 0.9, effectiveAnchor * 0.2)
        : Math.max(shortWindowRate * 0.95, effectiveAnchor * 0.2)
      : shortWindowRate;

  const baseForCap = Math.max(effectiveAnchor ?? 0, shortWindowPace, twelveHourRate ?? 0, twentyFourHourRate ?? 0);
  const capBase = baseForCap > 0 ? Math.max(baseForCap * 1.3, baseForCap + 0.45, 1.0) : 2.0;
  const capped = Math.min(Math.max(anchoredRate, floorRate), capBase);

  return clampMin(capped, 0);
}

function calculateWindowObservedRate(
  observed: UsageSnapshot[],
  latestCheckedAt: number,
  windowMs: number,
): number | null {
  const usable = observed.filter((snapshot) => snapshot.secondaryUsedPercent != null);
  if (usable.length < 2) {
    return null;
  }

  const startMs = latestCheckedAt - windowMs;
  let startIndex = usable.findIndex((snapshot) => snapshot.checkedAt >= startMs);
  if (startIndex === -1) {
    startIndex = usable.length - 1;
  }

  const previousPoint = startIndex > 0 ? usable[startIndex - 1] : null;
  const firstInWindow = usable[startIndex] ?? usable[usable.length - 1];
  const seedUsed =
    previousPoint?.secondaryUsedPercent ??
    firstInWindow?.secondaryUsedPercent ??
    usable[0]?.secondaryUsedPercent ??
    null;

  const windowPoints: UsageSnapshot[] =
    seedUsed != null
      ? [
          {
            ...((previousPoint ?? firstInWindow) as UsageSnapshot),
            checkedAt: startMs,
            secondaryUsedPercent: seedUsed,
          },
          ...usable.slice(startIndex),
        ]
      : usable.slice(startIndex);
  if (windowPoints.length < 2) {
    return null;
  }

  const first = windowPoints[0];
  const last = windowPoints[windowPoints.length - 1];
  const windowHours = (last.checkedAt - first.checkedAt) / (1000 * 60 * 60);
  const netRate =
    windowHours > 0
      ? clampMin(((last.secondaryUsedPercent ?? 0) - (first.secondaryUsedPercent ?? 0)) / windowHours, 0)
      : null;

  const segmentRates: number[] = [];
  for (let i = 1; i < windowPoints.length; i += 1) {
    const prev = windowPoints[i - 1];
    const cur = windowPoints[i];
    const deltaHours = (cur.checkedAt - prev.checkedAt) / (1000 * 60 * 60);
    if (deltaHours <= 0) {
      continue;
    }
    const deltaUsed = (cur.secondaryUsedPercent ?? 0) - (prev.secondaryUsedPercent ?? 0);
    segmentRates.push(clampMin(deltaUsed / deltaHours, 0));
  }
  if (segmentRates.length === 0) {
    return netRate;
  }
  segmentRates.sort((a, b) => a - b);
  const mid = Math.floor(segmentRates.length / 2);
  const medianRate =
    segmentRates.length % 2 === 0
      ? (segmentRates[mid - 1] + segmentRates[mid]) / 2
      : segmentRates[mid];

  if (netRate == null) {
    return medianRate;
  }

  return Math.max(netRate, medianRate);
}

function calculateRecentObservedRate(observed: UsageSnapshot[]): number | null {
  const usable = observed.filter((snapshot) => snapshot.secondaryUsedPercent != null);
  if (usable.length < 2) {
    return null;
  }

  const recent = usable.slice(-8);
  const segmentRates: number[] = [];
  for (let i = 1; i < recent.length; i += 1) {
    const prev = recent[i - 1];
    const cur = recent[i];
    const deltaHours = (cur.checkedAt - prev.checkedAt) / (1000 * 60 * 60);
    if (deltaHours <= 0) {
      continue;
    }
    const deltaUsed = (cur.secondaryUsedPercent ?? 0) - (prev.secondaryUsedPercent ?? 0);
    segmentRates.push(clampMin(deltaUsed / deltaHours, 0));
  }

  if (segmentRates.length === 0) {
    return null;
  }
  segmentRates.sort((a, b) => a - b);
  const mid = Math.floor(segmentRates.length / 2);
  return segmentRates.length % 2 === 0
    ? (segmentRates[mid - 1] + segmentRates[mid]) / 2
    : segmentRates[mid];
}

function weightedAverageRate(
  values: Array<{ rate: number | null; weight: number }>,
): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const value of values) {
    if (value.rate == null || !Number.isFinite(value.rate) || value.rate < 0 || value.weight <= 0) {
      continue;
    }
    numerator += value.rate * value.weight;
    denominator += value.weight;
  }
  return denominator > 0 ? numerator / denominator : null;
}

function estimateHitAt(
  startAt: number,
  usedNow: number,
  ratePercentPerHour: number | null,
): number | null {
  if (ratePercentPerHour == null || ratePercentPerHour <= 0) {
    return null;
  }
  const remaining = 100 - usedNow;
  if (remaining <= 0) {
    return startAt;
  }
  const hours = remaining / ratePercentPerHour;
  return startAt + hours * 60 * 60 * 1000;
}

function buildWeeklyWindowOptions(
  latest: UsageSnapshot | null,
  history: UsageSnapshot[],
): WeeklyWindowOption[] {
  if (!latest) {
    return [];
  }

  const weeklyMinutes = latest.secondaryWindowMinutes ?? 7 * 24 * 60;
  const windowMs = Math.max(60 * 60 * 1000, weeklyMinutes * 60 * 1000);
  const currentEnd =
    latest.secondaryResetAfterSeconds != null
      ? latest.checkedAt + latest.secondaryResetAfterSeconds * 1000
      : latest.checkedAt + windowMs;
  const currentStart = currentEnd - windowMs;
  const earliestHistory = history.length ? history[0].checkedAt : currentStart;
  const maxOffset = Math.max(0, Math.min(8, Math.floor((currentStart - earliestHistory) / windowMs)));

  const options: WeeklyWindowOption[] = [];
  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const start = currentStart - offset * windowMs;
    const end = currentEnd - offset * windowMs;
    const dateLabel = `${new Date(start).toLocaleDateString()} - ${new Date(end).toLocaleDateString()}`;
    options.push({
      offset,
      label: offset === 0 ? `Current week (${dateLabel})` : `Previous ${offset} (${dateLabel})`,
      start,
      end,
    });
  }
  return options;
}

function sameLocalDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function clampMin(value: number, min: number): number {
  return Math.max(min, value);
}

function calculateEvenPaceUsed(
  checkedAt: number,
  periodStart: number,
  resetAt: number,
): number {
  if (resetAt <= periodStart) {
    return 0;
  }
  const elapsedRatio = (checkedAt - periodStart) / (resetAt - periodStart);
  return clampPct(elapsedRatio * 100);
}

function addProjectedCurve(params: {
  addPoint: (checkedAt: number, usedActual: number | null, usedProjected: number | null) => void;
  startAt: number;
  endAt: number;
  startUsed: number;
  endUsed: number;
  steps: number;
  easing: "linear" | "easeIn";
}) {
  const { addPoint, startAt, endAt, startUsed, endUsed, steps, easing } = params;
  if (endAt <= startAt) {
    addPoint(startAt, null, clampPct(startUsed));
    return;
  }

  const totalSteps = Math.max(2, steps);
  for (let i = 0; i <= totalSteps; i += 1) {
    const t = i / totalSteps;
    const eased = easing === "easeIn" ? t * t : t;
    const checkedAt = Math.round(startAt + (endAt - startAt) * t);
    const usedProjected = clampPct(startUsed + (endUsed - startUsed) * eased);
    addPoint(checkedAt, null, usedProjected);
  }
}

function getHitLabelLeftPercent(
  periodStart: number | null,
  hitAt: number | null,
  resetAt: number | null,
): number {
  if (periodStart == null || hitAt == null || resetAt == null || resetAt <= periodStart) {
    return 50;
  }
  const rawPercent = ((hitAt - periodStart) / (resetAt - periodStart)) * 100;
  return Math.max(14, Math.min(86, rawPercent));
}

function formatLeadTime(
  hitAt: number | null,
  resetAt: number | null,
  hitState: PredictionTimeline["hitState"],
): string {
  if (hitState === "no_hit_before_reset") {
    return "No limit hit expected before reset";
  }
  if (hitAt == null || resetAt == null) {
    return "Need more data";
  }
  const diffMs = resetAt - hitAt;
  if (diffMs <= 0) {
    return "At or after reset";
  }
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) {
    return `About ${days}d ${hours}h before your limit resets`;
  }
  return `About ${hours}h before your limit resets`;
}
