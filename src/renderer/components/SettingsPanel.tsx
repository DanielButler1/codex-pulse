import { useState, type ChangeEvent, type ReactNode } from "react";
import {
  CalendarDays,
  Camera,
  CreditCard,
  Globe2,
  Monitor,
  MoonStar,
  ShieldCheck,
  SunMedium,
  Trash2,
} from "lucide-react";
import { SUBSCRIPTION_PLAN_META } from "../../../shared/subscription-plans";
import type { AppSettings, LeaderboardSyncStatus } from "../lib/types";

type SettingsPanelProps = {
  settings: AppSettings;
  onChange: (partial: Partial<AppSettings>) => void;
  leaderboardSyncStatus: LeaderboardSyncStatus;
  onSyncLeaderboard: () => void;
  onDeleteLeaderboardEntry: () => void;
};

export function SettingsPanel({ settings, onChange, leaderboardSyncStatus, onSyncLeaderboard, onDeleteLeaderboardEntry }: SettingsPanelProps) {
  const selectedPlan = SUBSCRIPTION_PLAN_META[settings.subscriptionPlan];
  const [profileImageError, setProfileImageError] = useState<string | null>(null);
  const leaderboardProfile = settings.leaderboardProfile;
  const profileInitials = getInitials(leaderboardProfile.displayName);

  const updateLeaderboardProfile = (
    partial: Partial<AppSettings["leaderboardProfile"]>,
  ) => {
    const next = { ...leaderboardProfile, ...partial };
    if (!next.displayName.trim()) {
      next.sharingEnabled = false;
    }
    onChange({ leaderboardProfile: next });
  };

  const onProfileImageSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      setProfileImageError(null);
      const avatarDataUrl = await resizeProfileImage(file);
      updateLeaderboardProfile({ avatarDataUrl });
    } catch (error) {
      setProfileImageError(error instanceof Error ? error.message : "Could not use that image.");
    }
  };

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

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-2 text-violet-300">
              <Globe2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-100">Community leaderboard</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-400">
                Create the public profile that will accompany your opt-in aggregate usage totals.
              </p>
            </div>
          </div>
          <div className={`rounded-full px-3 py-1 text-xs font-semibold ${leaderboardProfile.sharingEnabled ? "bg-emerald-500/15 text-emerald-300" : "bg-neutral-800 text-neutral-400"}`}>
            {leaderboardProfile.sharingEnabled ? "Opted in locally" : "Private"}
          </div>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
            <div className="flex items-center gap-4">
              <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 text-lg font-semibold text-neutral-300">
                {leaderboardProfile.avatarDataUrl ? (
                  <img
                    src={leaderboardProfile.avatarDataUrl}
                    alt="Leaderboard profile"
                    className="h-full w-full object-cover"
                  />
                ) : profileInitials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-neutral-100">
                  {leaderboardProfile.displayName || "Your public name"}
                </p>
                <p className="mt-1 text-sm text-neutral-500">Codex Pulse community profile</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-200 transition hover:border-neutral-600">
                <Camera className="h-4 w-4" />
                Choose photo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={onProfileImageSelected}
                />
              </label>
              {leaderboardProfile.avatarDataUrl ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 px-3 py-2 text-sm text-neutral-400 transition hover:border-red-500/40 hover:text-red-300"
                  onClick={() => updateLeaderboardProfile({ avatarDataUrl: "" })}
                >
                  <Trash2 className="h-4 w-4" /> Remove
                </button>
              ) : null}
            </div>
            {profileImageError ? <p className="mt-3 text-sm text-red-300">{profileImageError}</p> : null}
            <p className="mt-3 text-xs leading-5 text-neutral-500">PNG, JPEG, or WebP. Images are cropped and resized on this device.</p>
          </div>

          <div className="space-y-4">
            <label className="flex flex-col gap-2 text-sm text-neutral-300">
              <span className="font-medium text-neutral-200">Public display name</span>
              <input
                type="text"
                maxLength={40}
                placeholder="e.g. Daniel or @builder"
                className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-3 text-neutral-100 outline-none ring-violet-400 transition focus:ring-2"
                value={leaderboardProfile.displayName}
                onChange={(event) => updateLeaderboardProfile({ displayName: event.target.value })}
              />
              <span className="text-xs text-neutral-500">Use a real name or a handle. Your Codex email is never shown.</span>
            </label>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
                <ShieldCheck className="h-4 w-4 text-emerald-300" /> What will be shared
              </div>
              <p className="mt-2 text-sm leading-6 text-neutral-400">
                Aggregate token counts, estimated cost, request counts, active days, model totals,
                session counts, and record durations. Never prompts, code, file paths, repository
                names, raw session logs, email, or Codex credentials.
              </p>
            </div>

            <ToggleCard
              checked={leaderboardProfile.sharingEnabled}
              disabled={!leaderboardProfile.displayName.trim()}
              label="Join the community leaderboard"
              description={leaderboardProfile.displayName.trim()
                ? "I consent to these aggregate metrics and this public profile being shared on the Codex Pulse leaderboard."
                : "Add a public display name before opting in."}
              onChange={(sharingEnabled) => updateLeaderboardProfile({ sharingEnabled })}
            />

            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm leading-6 text-amber-100/70">
              {leaderboardSyncStatus.state === "synced" && leaderboardSyncStatus.lastSyncAt
                ? `Last uploaded ${new Date(leaderboardSyncStatus.lastSyncAt).toLocaleString()}. Automatic uploads run hourly.`
                : leaderboardSyncStatus.state === "error"
                  ? leaderboardSyncStatus.error
                  : leaderboardProfile.sharingEnabled
                    ? "Ready to upload. Automatic uploads run hourly while Codex Pulse is open."
                    : "Nothing is uploaded until you join the leaderboard."}
            </div>
            {leaderboardProfile.sharingEnabled ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={leaderboardSyncStatus.state === "syncing"} className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" onClick={onSyncLeaderboard}>
                  {leaderboardSyncStatus.state === "syncing" ? "Uploading…" : "Upload now"}
                </button>
                <button type="button" className="rounded-xl border border-red-500/30 px-4 py-2 text-sm font-medium text-red-300" onClick={onDeleteLeaderboardEntry}>
                  Leave and delete my entry
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>
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
  disabled = false,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex items-start gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-4 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
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

function getInitials(displayName: string): string {
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "CP";
}

async function resizeProfileImage(file: File): Promise<string> {
  if (!file.type.match(/^image\/(?:png|jpeg|webp)$/)) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Choose an image smaller than 5 MB.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not prepare that image.");
    }

    const cropSize = Math.min(bitmap.width, bitmap.height);
    const sourceX = (bitmap.width - cropSize) / 2;
    const sourceY = (bitmap.height - cropSize) / 2;
    context.drawImage(bitmap, sourceX, sourceY, cropSize, cropSize, 0, 0, 256, 256);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    bitmap.close();
  }
}
