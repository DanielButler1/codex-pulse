import type { ReactNode } from "react";

type UsageCardProps = {
  title: string;
  value: string;
  valueSubline?: string;
  subtitle?: string;
  hint?: string;
  progress?: number | null;
  footer?: ReactNode;
};

export function UsageCard({
  title,
  value,
  valueSubline,
  subtitle,
  hint,
  progress = null,
  footer,
}: UsageCardProps) {
  const clampedProgress =
    progress == null || Number.isNaN(progress) ? null : Math.min(100, Math.max(0, progress));

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-sm text-neutral-300">{title}</p>
      <p className="mt-2 text-4xl font-semibold text-neutral-100">{value}</p>
      {valueSubline ? <p className="mt-1 text-2xl font-medium text-neutral-300">{valueSubline}</p> : null}
      {subtitle ? <p className="mt-1 text-sm text-neutral-300">{subtitle}</p> : null}
      {hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
      {clampedProgress != null ? (
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all"
            style={{ width: `${clampedProgress}%` }}
          />
        </div>
      ) : null}
      {footer ? <div className="mt-3 text-sm text-neutral-300">{footer}</div> : null}
    </section>
  );
}
