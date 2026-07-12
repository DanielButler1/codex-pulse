import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Settings2 } from "lucide-react";
import { SUBSCRIPTION_PLAN_META } from "../../../shared/subscription-plans";
import type { AppSettings, ModelUsageRange, ModelUsageSummary } from "../lib/types";
import { ModelUsageHeatmap } from "./ModelUsageHeatmap";
import type { ModelUsageHeatmapData } from "../lib/types";

type ModelUsageTableProps = {
  summary: ModelUsageSummary | null;
  heatmap: ModelUsageHeatmapData | null;
  heatmapLoading: boolean;
  settings: AppSettings;
  range: ModelUsageRange;
  loading: boolean;
  onRangeChange: (range: ModelUsageRange) => void;
  onOpenSettings: () => void;
};

type ChartMode = "requests" | "tokens";
type TimelineMetric = "tokens" | "cost";

const RANGE_OPTIONS: Array<{ value: ModelUsageRange; label: string }> = [
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "period", label: "This period" },
  { value: "sub_period", label: "This sub period" },
  { value: "all", label: "All time" },
];

export function ModelUsageTable({
  summary,
  heatmap,
  heatmapLoading,
  settings,
  range,
  loading,
  onRangeChange,
  onOpenSettings,
}: ModelUsageTableProps) {
  const [chartMode, setChartMode] = useState<ChartMode>("tokens");
  const [timelineMetric, setTimelineMetric] = useState<TimelineMetric>("tokens");
  const [timelineCumulative, setTimelineCumulative] = useState(false);

  const chartData = useMemo(() => {
    const models = summary?.models ?? [];
    const sorted =
      chartMode === "requests"
        ? [...models].sort((a, b) => b.requests - a.requests)
        : [...models].sort((a, b) => b.totalTokens - a.totalTokens);

    return sorted.slice(0, 10).map((model) => ({
      model: model.model,
      requests: model.requests,
      uncachedInputTokens: Math.max(0, model.inputTokens - model.cachedInputTokens),
      cachedInputTokens: model.cachedInputTokens,
      outputTokens: model.outputTokens,
      totalTokens: model.totalTokens,
    }));
  }, [chartMode, summary]);

  const timelineData = useMemo(() => {
    const buckets = summary?.timeline.buckets ?? [];
    const granularity = summary?.timeline.granularity;
    if (buckets.length === 0 || !granularity) {
      return [];
    }

    let runningTokens = 0;
    let runningCost = 0;
    return buckets.map((bucket) => {
      runningTokens += bucket.totalTokens;
      runningCost += bucket.estimatedCostUsd;
      return {
        bucketStart: bucket.bucketStart,
        tokens: timelineCumulative ? runningTokens : bucket.totalTokens,
        cost: timelineCumulative ? runningCost : bucket.estimatedCostUsd,
      };
    });
  }, [summary?.timeline, timelineCumulative]);
  const timelineGranularity = summary?.timeline.granularity ?? "1h";
  const timelineTickInterval = useMemo(() => {
    if (timelineData.length <= 12) {
      return 0;
    }
    switch (timelineGranularity) {
      case "5m":
      case "15m":
        return 3;
      case "1h":
        return 2;
      case "6h":
        return 3;
      case "1d":
        return 2;
      case "1mo":
      default:
        return 0;
    }
  }, [timelineData.length, timelineGranularity]);
  const monthProjection = useMemo(() => {
    if (summary?.monthProjection) {
      return summary.monthProjection;
    }
    const now = summary?.generatedAt ?? Date.now();
    const monthStartDate = new Date(now);
    monthStartDate.setDate(1);
    monthStartDate.setHours(0, 0, 0, 0);
    const monthStart = monthStartDate.getTime();
    const monthEndDate = new Date(monthStart);
    monthEndDate.setMonth(monthEndDate.getMonth() + 1);
    const monthEnd = monthEndDate.getTime();
    const elapsedRatio = Math.max(
      0.001,
      Math.min(1, (now - monthStart) / Math.max(1, monthEnd - monthStart)),
    );

    const monthEntry = summary?.monthly.find((entry) => entry.monthStart === monthStart);
    let tokensSoFar = monthEntry?.totalTokens ?? 0;
    let estimatedCostSoFar = monthEntry?.estimatedCostUsd ?? 0;

    if (tokensSoFar <= 0 && summary?.timeline.buckets?.length) {
      for (const bucket of summary.timeline.buckets) {
        if (bucket.bucketStart >= monthStart && bucket.bucketStart <= now) {
          tokensSoFar += bucket.totalTokens;
          estimatedCostSoFar += bucket.estimatedCostUsd;
        }
      }
    }

    return {
      monthStart,
      monthEnd,
      elapsedRatio,
      tokensSoFar,
      estimatedCostSoFar,
      projectedTokens: tokensSoFar / elapsedRatio,
      projectedCostUsd: estimatedCostSoFar / elapsedRatio,
    };
  }, [summary]);
  const subscriptionContext = useMemo(() => {
    const meta = SUBSCRIPTION_PLAN_META[settings.subscriptionPlan];
    const period = resolveSubscriptionPeriod(settings.subscriptionLastRenewalDate);
    if (!period) {
      return {
        configured: false,
        planLabel: meta.label,
        monthlyCostUsd: meta.monthlyCostUsd,
        periodStart: null,
        periodEnd: null,
      };
    }
    return {
      configured: true,
      planLabel: meta.label,
      monthlyCostUsd: meta.monthlyCostUsd,
      periodStart: period.start,
      periodEnd: period.end,
    };
  }, [settings.subscriptionLastRenewalDate, settings.subscriptionPlan]);
  const subscriptionValueRatio =
    subscriptionContext.monthlyCostUsd > 0 && summary?.totals.estimatedCostUsd != null
      ? summary.totals.estimatedCostUsd / subscriptionContext.monthlyCostUsd
      : null;
  const limitUsageLabel =
    summary?.limitEstimate.scope === "current_weekly_limit"
      ? "currently reported weekly usage"
      : "observed weekly-limit consumption from tracked snapshots in this range";

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-neutral-200">Model usage</h2>
          <p className="text-sm text-neutral-400">
            {range === "period"
              ? "Requests and token usage by model in the current rate limit period. Limit use is estimated from API-cost weighting."
              : range === "sub_period"
                ? "Requests and token usage by model in the current subscription period"
                : "Requests and token usage by model from local rollout logs"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {RANGE_OPTIONS.map((candidate) => (
            <button
              key={candidate.value}
              className={`rounded-lg border px-3 py-1 text-xs transition ${
                range === candidate.value
                  ? "border-neutral-500 bg-neutral-800 text-white"
                  : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
              }`}
              type="button"
              disabled={loading}
              onClick={() => onRangeChange(candidate.value)}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-sm text-neutral-300 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Requests" value={formatInt(summary?.totals.requests)} />
        <Metric label="Input tokens" value={formatInt(summary?.totals.inputTokens)} />
        <Metric label="Output tokens" value={formatInt(summary?.totals.outputTokens)} />
        <Metric label="Cached input (subset)" value={formatInt(summary?.totals.cachedInputTokens)} />
        <Metric label="Reasoning output (subset)" value={formatInt(summary?.totals.reasoningOutputTokens)} />
        <Metric label="Total tokens" value={formatInt(summary?.totals.totalTokens)} />
        <Metric label="Est. API cost" value={formatUsd(summary?.totals.estimatedCostUsd)} />
      </div>

      {summary?.limitEstimate.totalUsedPercent != null ? (
        <p className="mt-3 text-xs text-neutral-500">
          Estimated limit use allocates {formatPercent(summary.limitEstimate.totalUsedPercent)} of {limitUsageLabel} by estimated API cost. Token share is based on observed local tokens.
        </p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-neutral-400">Loading model usage...</p>
      ) : range === "sub_period" && !subscriptionContext.configured ? (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-amber-100">Subscription period needs setup</p>
            <p className="mt-1 text-sm text-amber-100/75">
              Set your subscription plan and last renewal date to use this sub-period view.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-2 self-start rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm font-medium text-amber-50 transition hover:border-amber-300/50 hover:bg-amber-400/15"
          >
            <Settings2 className="h-4 w-4" />
            <span>Open settings</span>
          </button>
        </div>
      ) : summary == null ? (
        <p className="mt-4 text-sm text-neutral-400">No model usage events found for this range.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setChartMode("tokens")}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                chartMode === "tokens"
                  ? "border-neutral-500 bg-neutral-800 text-white"
                  : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
              }`}
            >
              Tokens
            </button>
            <button
              type="button"
              onClick={() => setChartMode("requests")}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                chartMode === "requests"
                  ? "border-neutral-500 bg-neutral-800 text-white"
                  : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
              }`}
            >
              Requests
            </button>
          </div>

	          <div className="mt-3 h-80 rounded-xl border border-neutral-800 bg-neutral-950 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 12, left: 0, bottom: 44 }}
                barGap={2}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis
                  dataKey="model"
                  stroke="#a3a3a3"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tick={{ fill: "#a3a3a3", fontSize: 12 }}
                  angle={-18}
                  textAnchor="end"
                  height={70}
                />
                <YAxis
                  stroke="#a3a3a3"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "#a3a3a3", fontSize: 12 }}
                  tickFormatter={formatCompactInt}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#171717",
                    border: "1px solid #404040",
                    borderRadius: "0.75rem",
                    color: "#f5f5f5",
                  }}
                  formatter={(value) => formatInt(coerceNumber(value))}
                />
                <Legend wrapperStyle={{ color: "#d4d4d4", fontSize: "12px" }} />

                {chartMode === "requests" ? (
                  <Bar dataKey="requests" fill="#ef4444" name="Requests" radius={[6, 6, 0, 0]} />
                ) : (
                  <>
                    <Bar
                      dataKey="uncachedInputTokens"
                      stackId="tokens"
                      fill="#ef4444"
                      name="Input (uncached)"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="cachedInputTokens"
                      stackId="tokens"
                      fill="#f59e0b"
                      name="Cached input"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="outputTokens"
                      stackId="tokens"
                      fill="#34d399"
                      name="Output"
                      radius={[6, 6, 0, 0]}
                    />
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
	          </div>

              {summary.models.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-400">No model usage events found for this range.</p>
              ) : null}
	
	          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-left text-neutral-400">
                  <th className="px-2 py-2">Model</th>
                  <th className="px-2 py-2">Requests</th>
                  <th className="px-2 py-2">Input</th>
                  <th className="px-2 py-2">Cached input subset</th>
                  <th className="px-2 py-2">Output</th>
                  <th className="px-2 py-2">Reasoning subset</th>
                  <th className="px-2 py-2">Total</th>
                  <th className="px-2 py-2">Token share</th>
                  <th className="px-2 py-2">Est. API cost</th>
                  <th className="px-2 py-2">Est. limit use</th>
                </tr>
              </thead>
              <tbody>
                {summary.models.map((model) => (
                  <tr key={model.model} className="border-b border-neutral-900 text-neutral-200">
                    <td className="px-2 py-2 font-medium text-neutral-100">{model.model}</td>
                    <td className="px-2 py-2">{formatInt(model.requests)}</td>
                    <td className="px-2 py-2">{formatInt(model.inputTokens)}</td>
                    <td className="px-2 py-2">{formatInt(model.cachedInputTokens)}</td>
                    <td className="px-2 py-2">{formatInt(model.outputTokens)}</td>
                    <td className="px-2 py-2">{formatInt(model.reasoningOutputTokens)}</td>
                    <td className="px-2 py-2">{formatInt(model.totalTokens)}</td>
                    <td className="px-2 py-2">{formatPercent(model.tokenSharePercent)}</td>
                    <td className="px-2 py-2">{formatUsd(model.estimatedCostUsd)}</td>
                    <td className="px-2 py-2">
                      {model.estimatedLimitUsagePercent == null
                        ? "--"
                        : formatPercent(model.estimatedLimitUsagePercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-700 text-neutral-100">
                  <td className="px-2 py-2 font-semibold">Total</td>
                  <td className="px-2 py-2 font-semibold">{formatInt(summary.totals.requests)}</td>
                  <td className="px-2 py-2 font-semibold">{formatInt(summary.totals.inputTokens)}</td>
                  <td className="px-2 py-2 font-semibold">
                    {formatInt(summary.totals.cachedInputTokens)}
                  </td>
                  <td className="px-2 py-2 font-semibold">{formatInt(summary.totals.outputTokens)}</td>
                  <td className="px-2 py-2 font-semibold">
                    {formatInt(summary.totals.reasoningOutputTokens)}
                  </td>
                  <td className="px-2 py-2 font-semibold">{formatInt(summary.totals.totalTokens)}</td>
                  <td className="px-2 py-2 font-semibold">100%</td>
                  <td className="px-2 py-2 font-semibold">{formatUsd(summary.totals.estimatedCostUsd)}</td>
                  <td className="px-2 py-2 font-semibold">
                    {summary.limitEstimate.totalUsedPercent == null
                      ? "--"
                      : formatPercent(summary.limitEstimate.totalUsedPercent)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

	          <div className="mt-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-neutral-200">Model usage over time</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTimelineMetric("tokens")}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                    timelineMetric === "tokens"
                      ? "border-neutral-500 bg-neutral-800 text-white"
                      : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
                  }`}
                >
                  Tokens
                </button>
                <button
                  type="button"
                  onClick={() => setTimelineMetric("cost")}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                    timelineMetric === "cost"
                      ? "border-neutral-500 bg-neutral-800 text-white"
                      : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
                  }`}
                >
                  Cost
                </button>
                <button
                  type="button"
                  onClick={() => setTimelineCumulative((value) => !value)}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                    timelineCumulative
                      ? "border-neutral-500 bg-neutral-800 text-white"
                      : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
                  }`}
                >
                  {timelineCumulative ? "Cumulative" : "Periodic"}
                </button>
              </div>
            </div>
	            {timelineData.length === 0 ? (
	              <p className="text-sm text-neutral-400">No usage buckets available yet.</p>
	            ) : (
              <div className="h-64 rounded-xl border border-neutral-800 bg-neutral-950 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timelineData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis
                      dataKey="bucketStart"
                      stroke="#a3a3a3"
                      tickLine={false}
                      axisLine={false}
                      interval={timelineTickInterval}
                      minTickGap={timelineGranularity === "6h" ? 22 : 16}
                      tick={{ fill: "#a3a3a3", fontSize: 12 }}
                      tickFormatter={(value: number) =>
                        formatBucketLabel(
                          value,
                          timelineGranularity,
                        )
                      }
                    />
                    <YAxis
                      stroke="#a3a3a3"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "#a3a3a3", fontSize: 12 }}
                      tickFormatter={(value: number) =>
                        timelineMetric === "cost" ? formatUsd(value) : formatCompactInt(value)
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#171717",
                        border: "1px solid #404040",
                        borderRadius: "0.75rem",
                        color: "#f5f5f5",
                      }}
                      labelFormatter={(value: unknown) => {
                        const timestamp = coerceNumber(value);
                        return formatBucketTooltipLabel(
                          timestamp,
                          timelineGranularity,
                        );
                      }}
                      formatter={(value: unknown) => {
                        const numeric = coerceNumber(value);
                        return timelineMetric === "cost" ? formatUsd(numeric) : formatInt(numeric);
                      }}
                    />
                    <Line
                      type="linear"
                      dataKey={timelineMetric}
                      stroke={timelineMetric === "cost" ? "#c4b5fd" : "#22c55e"}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls={false}
                      name={timelineMetric === "cost" ? "Estimated API cost" : "Total tokens"}
                    />
                  </LineChart>
	                </ResponsiveContainer>
	              </div>
	            )}
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-neutral-500">Projected month tokens</p>
                    <p className="mt-1 text-lg font-semibold text-neutral-100">
                      {formatInt(monthProjection.projectedTokens)}
                    </p>
                    <p className="text-xs text-neutral-400">
                      So far {formatInt(monthProjection.tokensSoFar)} at {Math.round(monthProjection.elapsedRatio * 100)}% of month
                    </p>
                  </div>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-neutral-500">Projected month API cost</p>
                    <p className="mt-1 text-lg font-semibold text-neutral-100">
                      {formatUsd(monthProjection.projectedCostUsd)}
                    </p>
                    <p className="text-xs text-neutral-400">
                      So far {formatUsd(monthProjection.estimatedCostSoFar)} at {Math.round(monthProjection.elapsedRatio * 100)}% of month
                    </p>
                  </div>
                </div>
                {range === "sub_period" ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                      <p className="text-xs uppercase tracking-wide text-neutral-500">Sub period API value</p>
                      <p className="mt-1 text-lg font-semibold text-neutral-100">
                        {formatUsd(summary.totals.estimatedCostUsd)}
                      </p>
                      <p className="text-xs text-neutral-400">
                        {subscriptionValueRatio != null
                          ? `${subscriptionValueRatio.toFixed(2)}x of ${subscriptionContext.planLabel} plan price`
                          : `${subscriptionContext.planLabel} plan`}
                      </p>
                    </div>
                    <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                      <p className="text-xs uppercase tracking-wide text-neutral-500">Billing period</p>
                      <p className="mt-1 text-lg font-semibold text-neutral-100">
                        {formatDateRange(subscriptionContext.periodStart, subscriptionContext.periodEnd)}
                      </p>
                      <p className="text-xs text-neutral-400">
                        {subscriptionContext.monthlyCostUsd > 0
                          ? `${subscriptionContext.planLabel} at ${formatUsd(subscriptionContext.monthlyCostUsd)} / month`
                          : "Free plan"}
                      </p>
                    </div>
                  </div>
                ) : null}

	        </div>
	        </>
	      )}

      <ModelUsageHeatmap heatmap={heatmap} loading={heatmapLoading} />
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
      <p className="text-sm text-neutral-400">{label}</p>
      <p className="mt-1 text-base font-semibold text-neutral-100">{value}</p>
    </div>
  );
}

function formatInt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "0";
  }
  return Math.max(0, Math.trunc(value)).toLocaleString();
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatCompactInt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "0";
  }
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(Math.max(0, value));
}

function formatDateRange(start: number | null, end: number | null): string {
  if (start == null || end == null) {
    return "Not configured";
  }
  return `${new Date(start).toLocaleDateString()} - ${new Date(end).toLocaleDateString()}`;
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
  const year = date.getFullYear();
  const monthIndex = date.getMonth() + months;
  const day = date.getDate();
  const targetYear = year + Math.floor(monthIndex / 12);
  const normalizedMonth = ((monthIndex % 12) + 12) % 12;
  const maxDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const next = new Date(targetYear, normalizedMonth, Math.min(day, maxDay));
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return "$0.00";
  }
  if (value > 0 && value < 0.01) {
    return "<$0.01";
  }
  if (value < 1) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 3,
      maximumFractionDigits: 4,
    }).format(value);
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatBucketLabel(
  bucketStart: number,
  granularity: "5m" | "15m" | "1h" | "6h" | "1d" | "1mo",
): string {
  const date = new Date(bucketStart);
  switch (granularity) {
    case "5m":
    case "15m":
    case "1h":
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    case "6h":
      return date.toLocaleDateString([], { month: "short", day: "2-digit" });
    case "1d":
      return date.toLocaleDateString([], { month: "short", day: "2-digit" });
    case "1mo":
    default:
      return date.toLocaleDateString([], { month: "short", year: "numeric" });
  }
}

function formatBucketTooltipLabel(
  bucketStart: number,
  granularity: "5m" | "15m" | "1h" | "6h" | "1d" | "1mo",
): string {
  const date = new Date(bucketStart);
  switch (granularity) {
    case "5m":
    case "15m":
    case "1h":
      return date.toLocaleString([], {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    case "6h":
      return date.toLocaleString([], {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    case "1d":
      return date.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
    case "1mo":
    default:
      return date.toLocaleDateString([], { month: "long", year: "numeric" });
  }
}

function coerceNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}
