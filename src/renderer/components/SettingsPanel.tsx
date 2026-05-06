import { useEffect, useMemo, useState } from "react";
import type {
  ProviderCatalogEntry,
  ProviderId,
  ProviderSecretField,
} from "../../../shared/provider-catalog";
import type {
  AppSettings,
  ProviderConfigurationView,
  ProviderConnectionSettings,
  ProviderSecretInput,
} from "../lib/types";

type SettingsPanelProps = {
  settings: AppSettings;
  selectedProviderId: ProviderId;
  providers: ProviderCatalogEntry[];
  providerConfig: ProviderConfigurationView;
  providerConfigLoading: boolean;
  providerConfigSaving: boolean;
  onSelectProvider: (providerId: ProviderId) => void;
  onChange: (partial: Partial<AppSettings>) => void;
  onUpdateProviderSettings: (partial: Partial<ProviderConnectionSettings>) => Promise<void>;
  onUpdateProviderSecrets: (partial: ProviderSecretInput) => Promise<void>;
};

export function SettingsPanel({
  settings,
  selectedProviderId,
  providers,
  providerConfig,
  providerConfigLoading,
  providerConfigSaving,
  onSelectProvider,
  onChange,
  onUpdateProviderSettings,
  onUpdateProviderSecrets,
}: SettingsPanelProps) {
  const selectedProvider =
    providers.find((provider) => provider.id === selectedProviderId) ?? providers[0] ?? null;

  return (
    <section className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-sm font-medium tracking-wide text-neutral-300">Settings</h2>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
          <h3 className="text-sm font-medium text-neutral-200">General</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-neutral-300">
              Theme
              <select
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none ring-neutral-400 focus:ring-2"
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
            <label className="flex flex-col gap-1 text-sm text-neutral-300">
              Limit card metric
              <select
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none ring-neutral-400 focus:ring-2"
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
          </div>
          <div className="mt-4 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
            Poll interval is fixed at <span className="font-semibold text-neutral-100">60 seconds</span>.
          </div>
          <div className="mt-4 flex flex-wrap gap-6 text-sm text-neutral-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.startAtLogin}
                onChange={(event) => onChange({ startAtLogin: event.target.checked })}
              />
              Start at login
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.notificationsEnabled}
                onChange={(event) => onChange({ notificationsEnabled: event.target.checked })}
              />
              Enable threshold notifications
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
          <h3 className="text-sm font-medium text-neutral-200">Provider config</h3>
          {providers.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-400">No provider-specific credentials are needed.</p>
          ) : (
            <div className="mt-4 grid gap-4">
              <label className="flex flex-col gap-1 text-sm text-neutral-300">
                Provider
                <select
                  className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none ring-neutral-400 focus:ring-2"
                  value={selectedProvider?.id ?? ""}
                  onChange={(event) => onSelectProvider(event.target.value as ProviderId)}
                >
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>
              {providerConfigLoading ? (
                <p className="text-xs text-neutral-500">Syncing stored secrets...</p>
              ) : null}
              {selectedProvider ? (
                <ProviderConfigForm
                  provider={selectedProvider}
                  config={providerConfig}
                  saving={providerConfigSaving}
                  onUpdateProviderSettings={onUpdateProviderSettings}
                  onUpdateProviderSecrets={onUpdateProviderSecrets}
                  onClearProviderSecret={(field) => onUpdateProviderSecrets({ [field]: "" })}
                />
              ) : null}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

export function ProviderConfigForm({
  provider,
  config,
  saving,
  onUpdateProviderSettings,
  onUpdateProviderSecrets,
  onClearProviderSecret,
}: {
  provider: ProviderCatalogEntry;
  config: ProviderConfigurationView;
  saving: boolean;
  onUpdateProviderSettings: (partial: Partial<ProviderConnectionSettings>) => Promise<void>;
  onUpdateProviderSecrets: (partial: ProviderSecretInput) => Promise<void>;
  onClearProviderSecret: (field: ProviderSecretField) => Promise<void>;
}) {
  const providerSettings = config.settings;
  const modeOptions = provider.settings.modeOptions;
  const secretFields = provider.settings.secretFields;
  const [secretInputs, setSecretInputs] = useState<Record<ProviderSecretField, string>>({
    apiKey: "",
    bearerToken: "",
    refreshToken: "",
    sessionCookie: "",
  });

  useEffect(() => {
    setSecretInputs({
      apiKey: "",
      bearerToken: "",
      refreshToken: "",
      sessionCookie: "",
    });
  }, [provider.id]);

  const secretStatus = useMemo(
    () => ({
      apiKey: config.secretFlags.hasApiKey,
      bearerToken: config.secretFlags.hasBearerToken,
      refreshToken: config.secretFlags.hasRefreshToken,
      sessionCookie: config.secretFlags.hasSessionCookie,
    }),
    [config.secretFlags],
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400">{provider.settings.hint}</p>

      {provider.settings.showAdvancedFields ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-neutral-300">
              Collector mode
              <select
                disabled={saving}
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none ring-neutral-400 focus:ring-2 disabled:opacity-60"
                value={providerSettings.mode}
                onChange={(event) =>
                  void onUpdateProviderSettings({
                    mode: event.target.value as ProviderConnectionSettings["mode"],
                  })
                }
              >
                {modeOptions.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-7 flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={providerSettings.enabled}
                disabled={saving}
                onChange={(event) =>
                  void onUpdateProviderSettings({
                    enabled: event.target.checked,
                  })
                }
              />
              Provider enabled
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {modeOptions.includes("api") || modeOptions.includes("web") ? (
              <TextField
                label="API base URL"
                value={providerSettings.apiBaseUrl}
                disabled={saving}
                onBlurSave={(value) => onUpdateProviderSettings({ apiBaseUrl: value })}
              />
            ) : null}
            {modeOptions.includes("cli") ? (
              <TextField
                label="CLI path"
                value={providerSettings.cliPath}
                disabled={saving}
                onBlurSave={(value) => onUpdateProviderSettings({ cliPath: value })}
              />
            ) : null}
            <TextField
              label="Account ID"
              value={providerSettings.accountId}
              disabled={saving}
              onBlurSave={(value) => onUpdateProviderSettings({ accountId: value })}
            />
            <TextField
              label="Workspace path"
              value={providerSettings.workspacePath}
              disabled={saving}
              onBlurSave={(value) => onUpdateProviderSettings({ workspacePath: value })}
            />
          </div>

          {modeOptions.includes("api") || modeOptions.includes("web") ? (
            <TextAreaField
              label="Headers JSON"
              value={providerSettings.headersJson}
              disabled={saving}
              rows={3}
              onBlurSave={(value) => onUpdateProviderSettings({ headersJson: value })}
            />
          ) : null}
          <TextAreaField
            label="Notes"
            value={providerSettings.notes}
            disabled={saving}
            rows={2}
            onBlurSave={(value) => onUpdateProviderSettings({ notes: value })}
          />
        </>
      ) : null}

      {secretFields.length > 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <h4 className="text-sm font-medium text-neutral-200">
            Secrets (stored in encrypted app storage)
          </h4>
          <p className="mt-1 text-xs text-neutral-400">
            Secret values are never shown after saving. Enter a value and click save to replace it.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {secretFields.map((field) => (
              <SecretField
                key={field}
                label={secretFieldLabel(field)}
                value={secretInputs[field]}
                status={secretStatus[field]}
                disabled={saving}
                onChange={(value) => setSecretInputs((prev) => ({ ...prev, [field]: value }))}
                onSave={async () => {
                  await onUpdateProviderSecrets({ [field]: secretInputs[field] } as ProviderSecretInput);
                  setSecretInputs((prev) => ({ ...prev, [field]: "" }));
                }}
                onClear={() => onClearProviderSecret(field)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function secretFieldLabel(field: ProviderSecretField): string {
  switch (field) {
    case "apiKey":
      return "API key";
    case "bearerToken":
      return "Bearer token";
    case "refreshToken":
      return "Refresh token";
    case "sessionCookie":
      return "Session cookie";
    default:
      return field;
  }
}

function TextField({
  label,
  value,
  disabled,
  onBlurSave,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onBlurSave: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <label className="flex flex-col gap-1 text-sm text-neutral-300">
      {label}
      <input
        type="text"
        value={draft}
        disabled={disabled}
        className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none ring-neutral-400 focus:ring-2 disabled:opacity-60"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== value) {
            void onBlurSave(draft);
          }
        }}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  rows,
  disabled,
  onBlurSave,
}: {
  label: string;
  value: string;
  rows: number;
  disabled: boolean;
  onBlurSave: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <label className="flex flex-col gap-1 text-sm text-neutral-300">
      {label}
      <textarea
        value={draft}
        rows={rows}
        disabled={disabled}
        className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none ring-neutral-400 focus:ring-2 disabled:opacity-60"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== value) {
            void onBlurSave(draft);
          }
        }}
      />
    </label>
  );
}

function SecretField({
  label,
  value,
  status,
  disabled,
  onChange,
  onSave,
  onClear,
}: {
  label: string;
  value: string;
  status: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSave: () => Promise<void>;
  onClear: () => Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
      <label className="flex flex-col gap-1 text-sm text-neutral-300">
        {label}
        <input
          type="password"
          value={value}
          disabled={disabled}
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none ring-neutral-400 focus:ring-2 disabled:opacity-60"
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter new value..."
        />
      </label>
      <p className={`mt-2 text-xs ${status ? "text-emerald-300" : "text-neutral-500"}`}>
        {status ? "Saved" : "Not set"}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={disabled || value.trim().length === 0}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void onSave()}
        >
          Save
        </button>
        <button
          type="button"
          disabled={disabled || !status}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void onClear()}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
