# Architecture

## Goals

- Keep all usage collection read-only and local-first.
- Support many providers via the same provider adapter pattern.
- Isolate provider-specific logic from shared scheduler, storage, and UI.

## High-level layout

- `src/main`: desktop process, polling, storage, tray, provider fetchers.
- `src/preload`: secure IPC bridge.
- `src/renderer`: React UI.
- `shared`: shared types and provider catalog.

## Provider model

Each provider should expose:

- metadata: id, display name, capabilities
- source strategies: ordered fallback chain
- normalization: provider-specific payload -> shared snapshot shape

Shared scheduler responsibilities:

- trigger polling cadence
- back off on repeated failures
- write a snapshot only when changed
- track provider health and error state

## Source strategy order

For each provider, the fetch chain should be explicit and ordered, for example:

1. OAuth/API source
2. CLI RPC
3. CLI PTY/text parse
4. local logs
5. optional web dashboard enrichment

This mirrors proven patterns used in CodexBar's provider docs and keeps fallback behavior understandable and testable.

## Storage

SQLite stores normalized snapshots and model-usage aggregates.

Core rules:

- never store raw secrets/tokens
- keep raw payload only if redacted
- retain bounded history with periodic pruning

## UI model

- Provider sidebar controls the active provider context.
- Main content area renders provider-specific cards and charts from normalized data.
- Settings remain global plus provider-specific sections over time.

## Cross-platform

Electron builder targets:

- Windows installer (NSIS)
- macOS disk image (DMG)
- Linux AppImage

Provider implementations must avoid platform assumptions unless explicitly guarded.
