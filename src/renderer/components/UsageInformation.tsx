import { useState } from "react";
import type { ModelUsagePerformance } from "../lib/types";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Props = {
  performance: ModelUsagePerformance;
};

const MODEL_COLORS = ["#4f8cff", "#22c55e", "#f59e0b", "#e879f9", "#14b8a6"];

export function UsageInformation({ performance }: Props) {
  const [hiddenModels, setHiddenModels] = useState<string[]>([]);
  const modelTotals = new Map<string, number>();
  for (const row of performance.daily) {
    modelTotals.set(row.model, (modelTotals.get(row.model) ?? 0) + row.outputTokens);
  }
  const chartModels = [...modelTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MODEL_COLORS.length)
    .map(([model]) => model);
  const chartDays = [...new Set(performance.daily.map((row) => row.dayStart))].sort((a, b) => a - b);
  const chartData = chartDays.map((dayStart) => {
    const row: Record<string, number | string | null> = {
      dayStart,
      label: formatDate(dayStart),
    };
    for (const [index, model] of chartModels.entries()) {
      row[`model_${index}`] = performance.daily.find((item) => item.dayStart === dayStart && item.model === model)?.throughputTokensPerSecond ?? null;
    }
    return row;
  });
  const recentRows = [...performance.daily].sort((a, b) => b.dayStart - a.dayStart || b.outputTokens - a.outputTokens);

  return (
    <section className="space-y-6">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Output speed</h2>
          <span className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400">
            Estimated from local activity
          </span>
        </div>
        <p className="mt-1 text-sm text-neutral-400">
          Daily tokens per second · Last 30 days · {performance.timezone}
        </p>
      </section>

      <section className="grid gap-5 border-y border-neutral-800 py-5 sm:grid-cols-3">
        <MetricCard label="Average speed" value={formatRate(performance.totals.throughputTokensPerSecond)} detail="Output tokens per second" />
        <MetricCard label="Responses" value={performance.totals.responseCount.toLocaleString()} detail={`${formatTokens(performance.totals.outputTokens)} output tokens`} />
        <MetricCard label="Generation time" value={formatDuration(performance.totals.durationMs)} detail="Model-active time" />
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-neutral-200">Speed by model</h3>
          <div className="flex flex-wrap gap-1" aria-label="Chart models">
            {chartModels.map((model, index) => {
              const visible = !hiddenModels.includes(model);
              return (
                <button
                  key={model}
                  type="button"
                  aria-pressed={visible}
                  onClick={() => setHiddenModels((models) => visible
                    ? [...models, model]
                    : models.filter((item) => item !== model))}
                  className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-400 ${visible ? "text-neutral-300" : "text-neutral-500"}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: visible ? MODEL_COLORS[index] : "#525252" }} />
                  {formatModel(model)}
                </button>
              );
            })}
          </div>
        </div>
        {chartData.length === 0 || chartModels.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-400">No token usage records with timing data are available yet.</p>
        ) : (
          <div className="mt-5 h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 12, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#2b2b2b" strokeDasharray="3 5" vertical={false} />
                <XAxis minTickGap={48} dataKey="dayStart" tickFormatter={formatDate} stroke="#737373" tickLine={false} axisLine={false} tick={{ fill: "#a3a3a3", fontSize: 12 }} />
                <YAxis tickFormatter={(value: number) => formatRate(value)} stroke="#737373" tickLine={false} axisLine={false} tick={{ fill: "#a3a3a3", fontSize: 12 }} width={64} />
                <Tooltip
                  cursor={{ stroke: "#525252" }}
                  contentStyle={{ backgroundColor: "#181818", border: "1px solid #525252", borderRadius: "0.5rem", color: "#f5f5f5" }}
                  labelFormatter={(value: unknown) => formatDate(Number(value))}
                  formatter={(value: unknown) => [formatRate(Number(value)), "Output rate"]}
                />
                {chartModels.map((model, index) => (
                  <Line key={model} type="monotone" dataKey={`model_${index}`} name={model} connectNulls hide={hiddenModels.includes(model)} stroke={MODEL_COLORS[index]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <details className="border-t border-neutral-800 pt-4">
        <summary className="cursor-pointer text-sm font-medium text-neutral-300 hover:text-neutral-100">Daily observations</summary>
        {recentRows.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-400">No daily observations are available yet.</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-xs tabular-nums">
              <thead className="border-b border-neutral-800 text-xs text-neutral-500">
                <tr>
                  <th className="pb-3 font-medium">Day</th>
                  <th className="pb-3 font-medium">Model</th>
                  <th className="pb-3 text-right font-medium">Output rate</th>
                  <th className="pb-3 text-right font-medium">Output</th>
                  <th className="pb-3 text-right font-medium">Responses</th>
                  <th className="pb-3 text-right font-medium">Median response</th>
                  <th className="pb-3 text-right font-medium">Estimated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/80">
                {recentRows.map((row) => (
                  <tr key={`${row.dayStart}:${row.model}`}>
                    <td className="py-3 text-neutral-300">{formatDate(row.dayStart)}</td>
                    <td className="py-3 font-medium text-neutral-100">{formatModel(row.model)}</td>
                    <td className="py-3 text-right font-medium text-neutral-100">{formatRate(row.throughputTokensPerSecond)}</td>
                    <td className="py-3 text-right text-neutral-300">{formatTokens(row.outputTokens)}</td>
                    <td className="py-3 text-right text-neutral-300">{row.responseCount.toLocaleString()}</td>
                    <td className="py-3 text-right text-neutral-300">{formatDuration(row.medianResponseDurationMs)}</td>
                    <td className="py-3 text-right text-neutral-300">{row.estimatedResponseCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer hover:text-neutral-300">About these estimates</summary>
        <p className="mt-2 max-w-2xl leading-5">
          {performance.totals.estimatedResponseCount.toLocaleString()} responses use estimated timing intervals. The p95 response duration is {formatDuration(performance.totals.p95ResponseDurationMs)}.
          The chart shows the five models with the most output tokens. Select a model to show or hide it.
        </p>
        <p className="mt-2 max-w-2xl leading-5">
        This is client-side telemetry, not server-side OpenAI timing. Exact spans come from reasoning and agent-message events; when a response has no matching span, the interval since the previous response for that model is used and counted as estimated.
        </p>
      </details>
    </section>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="mt-1 text-2xl font-medium tabular-nums tracking-tight text-neutral-50">{value}</p>
      <p className="mt-1 text-xs text-neutral-500">{detail}</p>
    </div>
  );
}

function formatRate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Not enough data";
  return `${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)} tps`;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDuration(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Not enough data";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  if (value < 3_600_000) return `${(value / 60_000).toFixed(1)} min`;
  return `${(value / 3_600_000).toFixed(1)} h`;
}

function formatDate(value: number): string {
  return new Date(value).toLocaleDateString([], { day: "numeric", month: "short" });
}

function formatModel(value: string): string {
  return value === "unknown" ? "Unknown" : value;
}
