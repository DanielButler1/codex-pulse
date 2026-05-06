# Contributing

## Before you start

- Keep provider logic isolated.
- Treat auth files and tokens as secrets.
- Prefer additive changes over broad refactors.
- If a renderer change affects layout, include a screenshot in the PR.

## Local setup

```bash
npm install
npm run dev
```

## Validation

Run the project checks before opening a PR:

```bash
npm run typecheck
npm run build
```

If you touch provider parsing or persistence, also verify the relevant collector path in the running app.

## PR checklist

- Describe the user-facing change.
- Call out any new provider fallback order or auth requirement.
- Mention whether the change affects packaging, startup, or tray behavior.
- Include screenshots for visual changes.
- Note any new secrets, files, or OS integration points explicitly.

## Security expectations

- Do not log access tokens, refresh tokens, cookies, or API keys.
- Do not add remote telemetry or upload snapshots off-device.
- Keep collectors read-only.

## Roadmap changes

If you are working on a new provider or collector source:

- Add or update the provider catalog entry.
- Add or update the collector documentation.
- Make the fallback path explicit.
- Keep the UI state honest when config is missing.
