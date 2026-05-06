# Roadmap

## Current phase

- Stabilize the Codex experience.
- Keep the renderer responsive during local parsing and refreshes.
- Make the repo easy to publish, package, and maintain on GitHub.

## Short term

- Tighten Codex usage projections and confidence messaging.
- Improve provider-specific empty states and config banners.
- Keep the tray-first startup behavior predictable on installed builds.
- Polish screenshots, docs, and release notes.

## Next providers

- Re-enable `Claude` with the correct provider-specific collector flow.
- Re-enable `OpenRouter` with its own balance/activity UI.
- Add back any provider only when its local data path is understood.

## Platform work

- Finish Windows release polish.
- Keep macOS and Linux packaging in sync.
- Add update checks and release notes to the shipped app.

## Longer term

- Provider adapter interface in the main process.
- Merged multi-provider overview.
- Additional analytics and exports.
- Budget alerts and anomaly detection.

## Guardrails

- Read-only collectors only.
- No prompt proxying.
- No token leakage.
- No remote upload of usage data.
- Explicit fallback ordering for every provider path.
