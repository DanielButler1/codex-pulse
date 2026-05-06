import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UsageSnapshot } from "../lib/types";

type UsageChartProps = {
  data: UsageSnapshot[];
  title: string;
  weeklyProjection?: {
    enabled: boolean;
    burnRatePercentPerHour: number | null;
    latestCheckedAt: number | null | undefined;
    secondaryUsedPercent: number | null | undefined;
    secondaryResetAfterSeconds: number | null | undefined;
    estimatedLimitHitAt?: number | null | undefined;
  };
};

type ChartRow = {
  checkedAt: number;
  primaryRemaining: number | null;
  secondaryRemaining: number | null;
  secondaryProjection: number | null;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export function UsageChart({ data, title, weeklyProjection }: UsageChartProps) {
  const historyRows: ChartRow[] = data.map((snapshot) => ({
    checkedAt: snapshot.checkedAt,
    primaryRemaining:
      snapshot.primaryUsedPercent == null ? null : Math.max(0, 100 - snapshot.primaryUsedPercent),
    secondaryRemaining:
      snapshot.secondaryUsedPercent == null ? null : Math.max(0, 100 - snapshot.secondaryUsedPercent),
    secondaryProjection: null,
  }));

  const observedStart = historyRows.length > 0 ? historyRows[0].checkedAt : Date.now();
  const observedEnd =
    historyRows.length > 0 ? historyRows[historyRows.length - 1].checkedAt : observedStart;
  const projectionResetAt =
    weeklyProjection?.enabled &&
    weeklyProjection.latestCheckedAt != null &&
    weeklyProjection.secondaryResetAfterSeconds != null
      ? weeklyProjection.latestCheckedAt + weeklyProjection.secondaryResetAfterSeconds * 1000
      : null;
  const domainEnd =
    projectionResetAt != null && projectionResetAt > observedEnd ? projectionResetAt : observedEnd;

  const projectionPoints = buildWeeklyProjectionPoints(weeklyProjection);
  const byTime = new Map<number, ChartRow>();
  for (const row of historyRows) {
    byTime.set(row.checkedAt, row);
  }
  for (const point of projectionPoints) {
    const existing = byTime.get(point.checkedAt);
    if (existing) {
      existing.secondaryProjection = point.secondaryProjection;
    } else {
      byTime.set(point.checkedAt, {
        checkedAt: point.checkedAt,
        primaryRemaining: null,
        secondaryRemaining: null,
        secondaryProjection: point.secondaryProjection,
      });
    }
  }

  const chartData = [...byTime.values()].sort((a, b) => a.checkedAt - b.checkedAt);
  const spansMultipleDays = !sameLocalDay(observedStart, domainEnd);

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-base font-medium text-neutral-200">{title}</h2>
      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
            <XAxis
              type="number"
              dataKey="checkedAt"
              domain={[observedStart, Math.max(observedStart + MINUTE_MS, domainEnd)]}
              stroke="#a3a3a3"
              tickLine={false}
              axisLine={false}
              tickCount={spansMultipleDays ? 8 : 10}
              minTickGap={24}
              tick={{ fill: "#a3a3a3", fontSize: 12 }}
              tickFormatter={(value: number) =>
                spansMultipleDays
                  ? new Date(value).toLocaleString([], {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : new Date(value).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
              }
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              stroke="#a3a3a3"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#a3a3a3", fontSize: 12 }}
              tickFormatter={(value: number) => `${Math.round(value)}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#171717",
                border: "1px solid #404040",
                borderRadius: "0.75rem",
                color: "#f5f5f5",
              }}
              formatter={(value: unknown) =>
                typeof value === "number" ? `${value.toFixed(1)}%` : String(value ?? "")
              }
              labelFormatter={(value: unknown) =>
                new Date(typeof value === "number" ? value : Number(value) || Date.now()).toLocaleString()
              }
            />
            <Line
              type="linear"
              dataKey="primaryRemaining"
              stroke="#34d399"
              dot={false}
              strokeWidth={2}
              name="5h left"
            />
            <Line
              type="linear"
              dataKey="secondaryRemaining"
              stroke="#ef4444"
              dot={false}
              strokeWidth={2}
              name="Weekly left"
            />
            <Line
              type="linear"
              dataKey="secondaryProjection"
              stroke="#f59e0b"
              dot={false}
              strokeWidth={2}
              strokeDasharray="6 4"
              connectNulls={false}
              name="Weekly projection"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function buildWeeklyProjectionPoints(
  projection: UsageChartProps["weeklyProjection"],
): Array<{ checkedAt: number; secondaryProjection: number }> {
  if (
    !projection?.enabled ||
    projection.latestCheckedAt == null ||
    projection.secondaryUsedPercent == null ||
    projection.secondaryResetAfterSeconds == null
  ) {
    return [];
  }

  const startTime = projection.latestCheckedAt;
  const resetAt = startTime + projection.secondaryResetAfterSeconds * 1000;
  if (resetAt <= startTime) {
    return [];
  }

  const startRemaining = Math.max(0, 100 - projection.secondaryUsedPercent);
  const estimatedHitAt =
    projection.estimatedLimitHitAt != null && projection.estimatedLimitHitAt > startTime
      ? projection.estimatedLimitHitAt
      : null;

  if (estimatedHitAt != null && estimatedHitAt < resetAt) {
    return [
      { checkedAt: startTime, secondaryProjection: startRemaining },
      { checkedAt: estimatedHitAt, secondaryProjection: 0 },
      { checkedAt: resetAt, secondaryProjection: 0 },
    ];
  }

  let projectedAtReset: number;
  if (estimatedHitAt != null && estimatedHitAt > resetAt) {
    const ratio = (resetAt - startTime) / (estimatedHitAt - startTime);
    projectedAtReset = Math.max(0, startRemaining * (1 - ratio));
  } else {
    const burnRate = Math.max(0, projection.burnRatePercentPerHour ?? 0);
    const hours = (resetAt - startTime) / HOUR_MS;
    projectedAtReset = Math.max(0, startRemaining - burnRate * hours);
  }

  return [
    { checkedAt: startTime, secondaryProjection: startRemaining },
    { checkedAt: resetAt, secondaryProjection: projectedAtReset },
  ];
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
