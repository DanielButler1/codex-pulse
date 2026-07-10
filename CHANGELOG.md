# Changelog

## 0.0.10-beta

- Fixed the Refresh now action crashing the app when a usage provider fails unexpectedly.
- Coalesced overlapping scheduled and manual usage polls to avoid concurrent refresh failures.
- Made reset-credit requests recover cleanly after rejected fetches.
- Added API cost estimates for GPT-5.6 Sol, Terra, and Luna, including cached-input pricing.

## 0.0.9-beta

- Added a Resets section that shows available Codex reset credits, including grant and expiry datetimes.
- Added a main-process reset-credit fetcher for the Codex backend endpoint with IPC support for the renderer.
- Fixed Codex auth token selection so backend requests prefer `access_token` over `id_token`.
- Kept failed reset-credit fetches out of the cache so a transient auth/backend error can recover on refresh.
