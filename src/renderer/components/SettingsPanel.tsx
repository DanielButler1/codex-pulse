import type { ReactNode } from "react";
import { CalendarDays, CreditCard, Monitor, MoonStar, SunMedium } from "lucide-react";
import { SUBSCRIPTION_PLAN_META } from "../../../shared/subscription-plans";
import type { AppSettings } from "../lib/types";

type SettingsPanelProps = {
  settings: AppSettings;
  onChange: (partial: Partial<AppSettings>) => void;
};

export function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  const selectedPlan = SUBSCRIPTION_PLAN_META[settings.subscriptionPlan];

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-neutral-100">Settings</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
              Configure the local Codex watcher and the subscription details used for the
              <span className="font-medium text-neutral-200"> This sub period </span>
              usage view.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryPill
              icon={<CreditCard className="h-4 w-4" />}
              label="Current plan"
              value={selectedPlan.label}
            />
            <SummaryPill
              icon={<CalendarDays className="h-4 w-4" />}
              label="Renewal"
              value={settings.subscriptionLastRenewalDate || "Not set"}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.95fr]">
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-300">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-100">Subscription window</h3>
              <p className="mt-1 text-sm text-neutral-400">
                Drives the monthly usage-value comparison and current billing period filter.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-neutral-300">
              <span className="font-medium text-neutral-200">Subscription plan</span>
              <select
                className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-3 text-neutral-100 outline-none ring-neutral-400 transition focus:ring-2"
                value={settings.subscriptionPlan}
                onChange={(event) =>
                  onChange({
                    subscriptionPlan: event.target.value as AppSettings["subscriptionPlan"],
                  })
                }
              >
                {Object.entries(SUBSCRIPTION_PLAN_META).map(([plan, meta]) => (
                  <option key={plan} value={plan}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-neutral-300">
              <span className="font-medium text-neutral-200">Last renewal date</span>
              <input
                type="date"
                className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-3 text-neutral-100 outline-none ring-neutral-400 transition focus:ring-2"
                value={settings.subscriptionLastRenewalDate}
                onChange={(event) =>
                  onChange({
                    subscriptionLastRenewalDate: event.target.value,
                  })
                }
              />
            </label>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <InfoTile label="Monthly plan value" value={formatUsd(selectedPlan.monthlyCostUsd)} />
            <InfoTile label="Usage range unlocked" value="This sub period" />
            <InfoTile
              label="Billing anchor"
              value={settings.subscriptionLastRenewalDate || "Required"}
            />
          </div>

          <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-4 text-sm leading-6 text-neutral-400">
            Enter the date your billing cycle last reset. Codex Pulse rolls that anchor forward
            month by month so the model usage panel can isolate your current subscription window.
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-2 text-sky-300">
              <Monitor className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-100">App preferences</h3>
              <p className="mt-1 text-sm text-neutral-400">
                Local display and background watcher behavior.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <label className="flex flex-col gap-2 text-sm text-neutral-300">
              <span className="font-medium text-neutral-200">Theme</span>
              <select
                className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-3 text-neutral-100 outline-none ring-neutral-400 transition focus:ring-2"
                value={settings.theme}
                onChange={(event) =>
                  onChange({ theme: event.target.value as AppSettings["theme"] })
                }
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-neutral-300">
              <span className="font-medium text-neutral-200">Limit card metric</span>
              <select
                className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-3 text-neutral-100 outline-none ring-neutral-400 transition focus:ring-2"
                value={settings.limitDisplayMode}
                onChange={(event) =>
                  onChange({
                    limitDisplayMode: event.target.value as AppSettings["limitDisplayMode"],
                  })
                }
              >
                <option value="remaining">Show remaining</option>
                <option value="used">Show used</option>
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleCard
                checked={settings.startAtLogin}
                label="Start at login"
                description="Keep the watcher running in the tray after sign-in."
                onChange={(checked) => onChange({ startAtLogin: checked })}
              />
              <ToggleCard
                checked={settings.notificationsEnabled}
                label="Threshold notifications"
                description="Notify when weekly usage approaches the limit."
                onChange={(checked) => onChange({ notificationsEnabled: checked })}
              />
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <SummaryPill
              icon={<MoonStar className="h-4 w-4" />}
              label="Dark mode"
              value={settings.theme === "dark" ? "Active" : "Optional"}
            />
            <SummaryPill
              icon={<SunMedium className="h-4 w-4" />}
              label="Poll cadence"
              value="60 seconds"
            />
            <SummaryPill
              icon={<Monitor className="h-4 w-4" />}
              label="Scope"
              value="Codex only"
            />
          </div>
        </section>
      </div>
    </section>
  );
}

function SummaryPill({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3">
      <div className="text-neutral-400">{icon}</div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
          {label}
        </p>
        <p className="mt-1 text-sm font-medium text-neutral-100">{value}</p>
      </div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-neutral-100">{value}</p>
    </div>
  );
}

function ToggleCard({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-4">
      <input
        type="checkbox"
        checked={checked}
        className="mt-1 h-4 w-4 rounded border-neutral-600 bg-neutral-900 text-emerald-500"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-neutral-100">{label}</span>
        <span className="mt-1 block text-sm leading-5 text-neutral-400">{description}</span>
      </span>
    </label>
  );
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
