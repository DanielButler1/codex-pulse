# Changelog

## 0.0.18-beta

- Added a dedicated Usage efficiency tab with observed tokens per weekly usage percentage and projected weekly token capacity.
- Moved model usage into its own tab and persisted custom projection reset targets until they expire.
- Added versioned incremental SQLite rollups for faster, memory-efficient long-term model usage and heatmap queries.

## 0.0.17-beta

- Fixed custom projection reset datetimes falling back to the weekly reset instead of updating the graph.

## 0.0.16-beta

- Added a custom reset date/time option for the projection graph.
- Kept custom projection resets isolated from the reported rate-limit reset card.

## 0.0.15-beta

- Added a graph-only projection reset selector for the default weekly reset or next available manual reset.
- Kept the reported rate-limit reset card unchanged when adjusting the projection horizon.
- Kept model-usage period switching available while usage data loads.
- Restored launch-time historical processing so the dashboard does not wait for a database backfill.

## 0.0.14-beta

- Redesigned the weekly limit graph around remaining capacity, target pace, actual usage, and a forward trajectory.
- Added On pace, Speed up, and Slow down states based on remaining capacity versus the target pace.
- Added hourly trajectory points with precise hover timestamps, and simplified the chart by removing x-axis labels and the historical momentum line.

## 0.0.12-beta

- Added token-share percentages for every model in the model usage table.
- Added cost-weighted estimated limit use per model for the current rate-limit period and longer tracked ranges.
- Aggregate confirmed weekly-limit increases across resets for multi-period estimates.

## 0.0.11-beta

- Require three consecutive readings before accepting a material overall usage drop as a limit reset.
- Ignore historical one- and two-sample drops that immediately recover when drawing charts and calculating burn rates.
- Keep legitimate readings that raise overall usage, even if one individual limit falls.
- Use explicit installer filenames that match auto-update manifests.

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
