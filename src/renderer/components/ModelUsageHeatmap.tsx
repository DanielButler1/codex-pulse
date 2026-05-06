import { useMemo, useRef, useState } from "react";
import type { ModelUsageHeatmapCell, ModelUsageHeatmapData } from "../lib/types";

type ModelUsageHeatmapProps = {
  heatmap: ModelUsageHeatmapData | null;
  loading: boolean;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => hour);

export function ModelUsageHeatmap({ heatmap, loading }: ModelUsageHeatmapProps) {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [hoveredCell, setHoveredCell] = useState<HeatmapTooltipState | null>(null);

  const heatmapData = useMemo(() => {
    const cells = heatmap?.cells ?? [];
    const cellMap = new Map(cells.map((cell) => [`${cell.dayIndex}:${cell.hour}`, cell] as const));
    const maxTokens = cells.reduce((max, cell) => Math.max(max, cell.totalTokens), 0);
    const positiveValues = cells
      .filter((cell) => cell.totalTokens > 0)
      .map((cell) => cell.totalTokens)
      .sort((left, right) => left - right);
    const lowAnchor = pickPercentile(positiveValues, 0.1) ?? positiveValues[0] ?? 0;
    const highAnchor = pickPercentile(positiveValues, 0.95) ?? maxTokens;
    const totalTokens = cells.reduce((sum, cell) => sum + cell.totalTokens, 0);
    const activeCells = cells.filter((cell) => cell.totalTokens > 0).length;

    let peakCell = cells[0] ?? null;
    for (const cell of cells) {
      if (peakCell == null || cell.totalTokens > peakCell.totalTokens) {
        peakCell = cell;
      }
    }

    const rows = DAY_LABELS.map((label, dayIndex) => ({
      label,
      dayIndex,
      cells: HOUR_LABELS.map((hour) => cellMap.get(`${dayIndex}:${hour}`) ?? null),
    }));

    return {
      rows,
      maxTokens,
      lowAnchor,
      highAnchor,
      totalTokens,
      activeCells,
      peakCell,
    };
  }, [heatmap]);

  return (
    <section className="relative mt-5 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-neutral-100">Usage heatmap</h3>
          <p className="text-xs text-neutral-400">
            All-time token intensity by weekday and hour, shown on a compressed scale.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-neutral-400">
          <span>Low</span>
          <div className="h-2 w-28 rounded-full border border-neutral-700 bg-gradient-to-r from-neutral-800 via-emerald-900 to-emerald-400" />
          <span>High</span>
        </div>
      </div>

      {loading ? (
        <HeatmapSkeleton />
      ) : heatmap == null || heatmapData.maxTokens === 0 ? (
        <p className="mt-4 text-sm text-neutral-400">No all-time heatmap data available yet.</p>
      ) : (
        <>
          <div ref={sectionRef} className="relative mt-4">
            <div className="overflow-x-auto pb-1">
              <div className="min-w-[52rem]">
                <div className="grid grid-cols-[5.5rem_repeat(24,minmax(0,1fr))] gap-1">
                  <div />
                  {HOUR_LABELS.map((hour) => (
                    <div
                      key={hour}
                      className="px-1 text-center text-[10px] font-medium tracking-wide text-neutral-500"
                    >
                      {hour % 6 === 0 ? hour : ""}
                    </div>
                  ))}

                  {heatmapData.rows.map((row) => (
                    <HeatmapRow
                      key={row.dayIndex}
                      label={row.label}
                      dayIndex={row.dayIndex}
                      cells={row.cells}
                      totalTokens={heatmapData.totalTokens}
                      lowAnchor={heatmapData.lowAnchor}
                      highAnchor={heatmapData.highAnchor}
                      onHover={setHoveredCell}
                      onClearHover={() => setHoveredCell(null)}
                      sectionRef={sectionRef}
                    />
                  ))}
                </div>
                <div className="mt-1 flex items-center justify-between pl-[5.5rem] pr-1 text-[10px] text-neutral-500">
                  <span>0</span>
                  <span>24</span>
                </div>
              </div>
            </div>

            {hoveredCell ? <HeatmapTooltip cell={hoveredCell} /> : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-400">
            <div>
              Peak slot:{" "}
              <span className="text-neutral-200">
                {formatPeakLabel(heatmapData.peakCell)} {formatCompactInt(heatmapData.peakCell?.totalTokens)}
              </span>
            </div>
            <div>
              Active slots:{" "}
              <span className="text-neutral-200">
                {heatmapData.activeCells}/{heatmapData.rows.length * HOUR_LABELS.length}
              </span>
            </div>
            <div>
              Total: <span className="text-neutral-200">{formatCompactInt(heatmapData.totalTokens)} tokens</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function HeatmapRow({
  label,
  dayIndex,
  cells,
  totalTokens,
  lowAnchor,
  highAnchor,
  onHover,
  onClearHover,
  sectionRef,
}: {
  label: string;
  dayIndex: number;
  cells: Array<ModelUsageHeatmapCell | null>;
  totalTokens: number;
  lowAnchor: number;
  highAnchor: number;
  onHover: (state: HeatmapTooltipState) => void;
  onClearHover: () => void;
  sectionRef: { current: HTMLDivElement | null };
}) {
  return (
    <>
      <div className="flex items-center justify-end pr-2 text-xs font-medium text-neutral-400">
        {label}
      </div>
      {cells.map((cell, hour) => {
        const value = cell?.totalTokens ?? 0;
        const intensity = value > 0 ? getCompressedIntensity(value, lowAnchor, highAnchor) : 0;
        const shareOfTotal = totalTokens > 0 ? value / totalTokens : 0;
        const backgroundColor =
          value > 0
            ? `rgba(16, 185, 129, ${0.12 + intensity * 0.76})`
            : "rgba(38, 38, 38, 0.72)";
        const borderColor =
          value > 0
            ? `rgba(16, 185, 129, ${0.15 + intensity * 0.32})`
            : "rgba(64, 64, 64, 0.75)";

        return (
          <button
            key={`${dayIndex}-${hour}`}
            type="button"
            onMouseEnter={(event) => {
              onHover(
                buildTooltipState(event.currentTarget, sectionRef, {
                  dayIndex,
                  hour,
                  value,
                  shareOfTotal,
                  intensity,
                }),
              );
            }}
            onMouseMove={(event) => {
              onHover(
                buildTooltipState(event.currentTarget, sectionRef, {
                  dayIndex,
                  hour,
                  value,
                  shareOfTotal,
                  intensity,
                }),
              );
            }}
            onMouseLeave={onClearHover}
            onFocus={(event) => {
              onHover(
                buildTooltipState(event.currentTarget, sectionRef, {
                  dayIndex,
                  hour,
                  value,
                  shareOfTotal,
                  intensity,
                }),
              );
            }}
            onBlur={onClearHover}
            className="h-7 rounded-md border transition duration-150 hover:-translate-y-px hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            aria-label={buildAriaLabel(dayIndex, hour, value, shareOfTotal, intensity)}
            style={{
              backgroundColor,
              borderColor,
            }}
          >
            <span className="sr-only">{buildAriaLabel(dayIndex, hour, value, shareOfTotal, intensity)}</span>
          </button>
        );
      })}
    </>
  );
}

function formatCompactInt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "0";
  }
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(Math.max(0, value));
}

function formatPeakLabel(cell: { dayIndex: number; hour: number } | null): string {
  if (!cell) {
    return "None";
  }
  return `${DAY_LABELS[cell.dayIndex]} ${String(cell.hour).padStart(2, "0")}:00`;
}

function getCompressedIntensity(value: number, lowAnchor: number, highAnchor: number): number {
  const safeLow = Math.max(1, lowAnchor);
  const safeHigh = Math.max(safeLow + 1, highAnchor);
  const lowLog = Math.log10(safeLow);
  const highLog = Math.log10(safeHigh);
  const valueLog = Math.log10(Math.max(1, value));
  if (!Number.isFinite(lowLog) || !Number.isFinite(highLog) || highLog <= lowLog) {
    return 1;
  }
  const normalized = (valueLog - lowLog) / (highLog - lowLog);
  return Math.max(0, Math.min(1, normalized));
}

function pickPercentile(values: number[], percentile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const clamped = Math.max(0, Math.min(1, percentile));
  const index = Math.round((values.length - 1) * clamped);
  return values[index] ?? null;
}

type HeatmapTooltipState = {
  label: string;
  tokens: string;
  rawTokens: string;
  shareOfTotal: string;
  intensity: string;
  left: number;
  top: number;
  placement: "top" | "bottom";
};

function buildTooltipState(
  element: HTMLButtonElement,
  sectionRef: { current: HTMLDivElement | null },
  params: {
    dayIndex: number;
    hour: number;
    value: number;
    shareOfTotal: number;
    intensity: number;
  },
): HeatmapTooltipState {
  const section = sectionRef.current?.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const tooltipWidth = 280;
  const leftRaw = section ? rect.left - section.left + rect.width / 2 : rect.left + rect.width / 2;
  const topRaw = section ? rect.top - section.top : rect.top;
  const spaceAbove = topRaw;
  const spaceBelow = section ? section.height - (topRaw + rect.height) : 0;
  const placement = spaceBelow > 140 || spaceBelow > spaceAbove ? "bottom" : "top";
  const left = section
    ? clamp(leftRaw, tooltipWidth / 2 + 12, Math.max(tooltipWidth / 2 + 12, section.width - tooltipWidth / 2 - 12))
    : leftRaw;
  const top = topRaw + (placement === "top" ? 4 : rect.height - 4);

  return {
    label: `${DAY_LABELS[params.dayIndex]} ${String(params.hour).padStart(2, "0")}:00`,
    tokens: formatCompactInt(params.value),
    rawTokens: new Intl.NumberFormat().format(params.value),
    shareOfTotal: formatRatio(params.shareOfTotal),
    intensity: `${Math.round(params.intensity * 100)}%`,
    left,
    top,
    placement,
  };
}

function HeatmapTooltip({ cell }: { cell: HeatmapTooltipState }) {
  const transform = cell.placement === "top" ? "translate(-50%, -100%)" : "translate(-50%, 0)";
  const arrowClass =
    cell.placement === "top"
      ? "-bottom-1.5 border-b-0 border-r border-t border-l"
      : "-top-1.5 border-t-0 border-r border-b border-l";

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        left: cell.left,
        top: cell.top,
        transform,
      }}
    >
      <div className="relative min-w-56 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 shadow-2xl">
        <div
          className={`absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-neutral-700 bg-neutral-900 ${arrowClass}`}
        />
        <div className="relative space-y-1">
          <div className="text-[11px] font-semibold text-neutral-100">{cell.label}</div>
          <div className="flex items-center justify-between gap-4 text-neutral-300">
            <span>Tokens</span>
            <span className="font-medium text-neutral-100">{cell.rawTokens}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-neutral-300">
            <span>Share of total</span>
            <span className="font-medium text-neutral-100">{cell.shareOfTotal}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-neutral-300">
            <span>Relative intensity</span>
            <span className="font-medium text-neutral-100">{cell.intensity}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRatio(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0%";
  }
  return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
}

function buildAriaLabel(
  dayIndex: number,
  hour: number,
  value: number,
  shareOfTotal: number,
  intensity: number,
): string {
  return [
    `${DAY_LABELS[dayIndex]} ${String(hour).padStart(2, "0")}:00`,
    `${new Intl.NumberFormat().format(Math.max(0, value))} tokens`,
    `${formatRatio(shareOfTotal)} of all-time total`,
    `${Math.round(Math.max(0, intensity) * 100)}% relative intensity`,
  ].join(", ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function HeatmapSkeleton() {
  return (
    <div className="mt-4">
      <div className="grid grid-cols-[5.5rem_repeat(24,minmax(0,1fr))] gap-1">
        <div />
        {HOUR_LABELS.map((hour) => (
          <div key={hour} className="px-1 text-center text-[10px] text-neutral-600">
            {hour % 6 === 0 ? hour : ""}
          </div>
        ))}
        {DAY_LABELS.map((label, dayIndex) => (
          <HeatmapSkeletonRow key={label} label={label} dayIndex={dayIndex} />
        ))}
      </div>
      <p className="mt-3 text-xs text-neutral-500">Loading all-time heatmap...</p>
    </div>
  );
}

function HeatmapSkeletonRow({
  label,
  dayIndex,
}: {
  label: string;
  dayIndex: number;
}) {
  return (
    <>
      <div className="flex items-center justify-end pr-2 text-xs font-medium text-neutral-500">
        {label}
      </div>
      {HOUR_LABELS.map((hour) => (
        <div
          key={`${dayIndex}-${hour}`}
          className="h-7 animate-pulse rounded-md border border-neutral-800 bg-neutral-800/60"
        />
      ))}
    </>
  );
}

