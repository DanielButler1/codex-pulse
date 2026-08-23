import type { UsageEfficiencySummary } from "../lib/types";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Props = {
  summary: UsageEfficiencySummary | null;
  loading: boolean;
};

export function UsageEfficiencyPanel({ summary, loading }: Props) {
  if (loading && !summary) {
    return <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-neutral-400">Calculating usage efficiency…</div>;
  }

  const usableWeeks = summary?.weeks.filter((week) => week.tokensPerPercent != null) ?? [];
  const chartWeeks = [...usableWeeks].sort((a, b) => a.resetAt - b.resetAt);
  return (
    <div className="space-y-5">
      <section>
        <h2 className="text-2xl font-semibold">Usage efficiency</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Observed rollout tokens per weekly usage percentage point over retained history.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Tokens per 1%" value={formatTokens(summary?.tokensPerPercent)} />
        <MetricCard label="Estimated weekly tokens" value={formatTokens(summary?.projectedWeeklyTokens)} />
        <MetricCard
          label="Estimate confidence"
          value={summary ? capitalize(summary.confidence) : "Not enough data"}
          detail={summary ? `${formatPercent(summary.observedUsagePercent)} observed across ${usableWeeks.length} ${usableWeeks.length === 1 ? "week" : "weeks"}` : undefined}
        />
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <h3 className="text-lg font-semibold">Estimated weekly tokens over time</h3>
        <p className="mt-1 text-sm text-neutral-400">
          Projected 100% allowance for each observed reset window. Usage snapshots are retained for one year.
        </p>
        {chartWeeks.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-400">Not enough weekly observations to chart yet.</p>
        ) : (
          <div className="mt-5 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartWeeks} margin={{ top: 12, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#2b2b2b" strokeDasharray="3 5" vertical={false} />
                <XAxis
                  dataKey="resetAt"
                  tickFormatter={formatShortDate}
                  stroke="#737373"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "#a3a3a3", fontSize: 12 }}
                />
                <YAxis
                  domain={[0, "auto"]}
                  tickFormatter={formatCompactTokens}
                  stroke="#737373"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "#a3a3a3", fontSize: 12 }}
                  width={58}
                />
                <Tooltip
                  cursor={{ fill: "#262626" }}
                  contentStyle={{ backgroundColor: "#181818", border: "1px solid #525252", borderRadius: "0.5rem", color: "#f5f5f5" }}
                  formatter={(value: unknown) => [formatTokens(typeof value === "number" ? value : Number(value)), "Estimated weekly tokens"]}
                  labelFormatter={(value: unknown) => `Resets ${formatDateTime(Number(value))}`}
                />
                {summary?.projectedWeeklyTokens != null ? (
                  <ReferenceLine y={summary.projectedWeeklyTokens} stroke="#a3a3a3" strokeDasharray="4 4" />
                ) : null}
                <Bar dataKey="projectedWeeklyTokens" fill="#4f8cff" radius={[5, 5, 0, 0]} maxBarSize={72} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <div>
          <h3 className="text-lg font-semibold">Weekly observations</h3>
          <p className="mt-1 text-sm text-neutral-400">
            Resets and reported usage drops are excluded. Estimates become more reliable as more percentage movement is observed.
          </p>
        </div>
        {usableWeeks.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-400">Not enough paired token and weekly usage movement yet.</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-neutral-800 text-xs uppercase tracking-[0.12em] text-neutral-500">
                <tr>
                  <th className="pb-3 font-medium">Reset window</th>
                  <th className="pb-3 text-right font-medium">Usage observed</th>
                  <th className="pb-3 text-right font-medium">Tokens</th>
                  <th className="pb-3 text-right font-medium">Tokens / 1%</th>
                  <th className="pb-3 text-right font-medium">Weekly estimate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/80">
                {usableWeeks.map((week) => (
                  <tr key={week.resetAt}>
                    <td className="py-3 text-neutral-200">Resets {formatDateTime(week.resetAt)}</td>
                    <td className="py-3 text-right text-neutral-300">{formatPercent(week.observedUsagePercent)}</td>
                    <td className="py-3 text-right text-neutral-300">{formatTokens(week.totalTokens)}</td>
                    <td className="py-3 text-right font-medium text-neutral-100">{formatTokens(week.tokensPerPercent)}</td>
                    <td className="py-3 text-right text-neutral-300">{formatTokens(week.projectedWeeklyTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs leading-5 text-neutral-500">
        This is an empirical estimate. Weekly usage is influenced by model choice, cached input, reasoning effort, and request shape, so the effective token allowance can change.
      </p>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-neutral-50">{value}</p>
      {detail ? <p className="mt-2 text-xs text-neutral-400">{detail}</p> : null}
    </div>
  );
}

function formatTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Not enough data";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(value < 10 ? 1 : 0)}%`;
}

function formatDateTime(value: number): string {
  return new Date(value).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatShortDate(value: number): string {
  return new Date(value).toLocaleDateString([], { day: "numeric", month: "short" });
}

function formatCompactTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 0 }).format(value);
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
