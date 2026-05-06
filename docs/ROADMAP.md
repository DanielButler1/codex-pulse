# Roadmap

## Phase 1 (current)

- Stabilize Codex provider UX and prediction quality.
- Keep app responsive during heavy model-usage parsing.
- Harden packaging/docs/CI for public GitHub repo.

## Phase 2

- Introduce provider adapter interface in main process.
- Move Codex into adapter implementation.
- Add provider health/status surface in sidebar.

## Phase 3

- Add Claude provider (CLI + local logs; optional web source).
- Add Cursor provider (local/web account usage).
- Add Gemini provider (CLI/OAuth usage paths).

## Phase 4

- Add Copilot/OpenRouter adapters.
- Add merged “All providers” overview.
- Add per-provider cost and forecast cards.

## Phase 5

- Advanced analytics:
  - model-family trends
  - anomaly detection
  - budget alarms
  - export/backup

## Guardrails

- No token leakage.
- Read-only collectors.
- Explicit fallback order per provider.
- Feature flags for high-risk collectors (web/cookie sources).
