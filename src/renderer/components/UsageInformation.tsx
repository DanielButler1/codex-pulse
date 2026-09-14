import type { ModelUsagePerformance } from "../lib/types";
import {
  CartesianGrid,
  Legend,
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
    for (const model of chartModels) {
      row[model] = performance.daily.find((item) => item.dayStart === dayStart && item.model === model)?.throughputTokensPerSecond ?? null;
    }
    return row;
  });
  const recentRows = [...performance.daily].sort((a, b) => b.dayStart - a.dayStart || b.outputTokens - a.outputTokens);

  return (
    <section className="space-y-5">
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-semibold">Throughput over time</h2>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">
            Rough estimate
          </span>
        </div>
        <p className="mt-1 text-sm text-neutral-400">
          Output tokens divided by model-active generation time, grouped by local day and model. The current view covers the last 30 days ({performance.timezone}).
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Observed rate" value={formatRate(performance.totals.throughputTokensPerSecond)} detail="Output tokens per second" />
        <MetricCard label="Responses" value={performance.totals.responseCount.toLocaleString()} detail={`${formatTokens(performance.totals.outputTokens)} output tokens`} />
        <MetricCard label="Generation time" value={formatDuration(performance.totals.durationMs)} detail={`p95 response ${formatDuration(performance.totals.p95ResponseDurationMs)}`} />
        <MetricCard label="Estimated samples" value={performance.totals.estimatedResponseCount.toLocaleString()} detail="Interval-based timings" />
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <h3 className="text-lg font-semibold">Daily output rate by model</h3>
        <p className="mt-1 text-sm text-neutral-400">The five models with the most output tokens in this period are shown.</p>
        {chartData.length === 0 || chartModels.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-400">No token usage records with timing data are available yet.</p>
        ) : (
          <div className="mt-5 h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 12, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#2b2b2b" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="dayStart" tickFormatter={formatDate} stroke="#737373" tickLine={false} axisLine={false} tick={{ fill: "#a3a3a3", fontSize: 12 }} />
                <YAxis tickFormatter={(value: number) => formatRate(value)} stroke="#737373" tickLine={false} axisLine={false} tick={{ fill: "#a3a3a3", fontSize: 12 }} width={64} />
                <Tooltip
                  cursor={{ stroke: "#525252" }}
                  contentStyle={{ backgroundColor: "#181818", border: "1px solid #525252", borderRadius: "0.5rem", color: "#f5f5f5" }}
                  labelFormatter={(value: unknown) => formatDate(Number(value))}
                  formatter={(value: unknown) => [formatRate(Number(value)), "Output rate"]}
                />
                <Legend formatter={(value) => formatModel(value)} />
                {chartModels.map((model, index) => (
                  <Line key={model} type="monotone" dataKey={model} name={model} connectNulls stroke={MODEL_COLORS[index]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <h3 className="text-lg font-semibold">Daily model observations</h3>
        <p className="mt-1 text-sm text-neutral-400">Use this table to compare rates consistently across models and days.</p>
        {recentRows.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-400">No daily observations are available yet.</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-neutral-800 text-xs uppercase tracking-[0.12em] text-neutral-500">
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
      </section>

      <p className="text-xs leading-5 text-neutral-500">
        This is client-side telemetry, not server-side OpenAI timing. Exact spans come from reasoning and agent-message events; when a response has no matching span, the interval since the previous response for that model is used and counted as estimated.
      </p>
    </section>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-neutral-50">{value}</p>
      <p className="mt-2 text-xs text-neutral-400">{detail}</p>
    </div>
  );
}

function formatRate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Not enough data";
  return `${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)}/s`;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDuration(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Not enough data";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  return `${(value / 60_000).toFixed(1)} min`;
}

function formatDate(value: number): string {
  return new Date(value).toLocaleDateString([], { day: "numeric", month: "short" });
}

function formatModel(value: string): string {
  return value === "unknown" ? "Unknown" : value;
}
