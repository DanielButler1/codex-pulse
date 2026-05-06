# Codex Pulse

Codex Pulse is a local, privacy-first desktop usage monitor for coding agents.

## What it does

- Monitors Codex usage locally without proxying prompts.
- Tracks additional providers through a shared adapter model.
- Stores snapshots in local SQLite only.
- Renders provider-specific balance, usage, and trend views.

## Current status

- `Codex` is implemented end-to-end.
- `OpenRouter` is implemented with balance and activity views.
- Other providers are scaffolded or marked `Coming soon`.
- The app is tray-first, starts hidden on installed builds, and is configured to start at login by default.

## Repo readiness

This repository is set up to be pushed to GitHub as-is:

- Cross-platform desktop build config is present.
- CI runs on Windows and macOS via GitHub Actions.
- Temp scraping artifacts and build outputs are ignored.
- Local secrets stay in app data / keychain, not in the repo.

## Tech stack

- Electron + `electron-vite`
- React + TypeScript
- Tailwind CSS
- Recharts
- `better-sqlite3`
- `electron-builder`

## Security model

- Reads local auth/files only when required by enabled providers.
- Never prints access tokens in UI or logs.
- Stores snapshots only in local SQLite (`app.getPath("userData")/codex-pulse.db`).
- No prompt proxying, no remote telemetry upload.

## Quick start

```bash
npm install
npm run dev
```

## Validation

```bash
npm run typecheck
npm run build
```

## Packaging

`electron-builder` is configured for:

- Windows (`nsis`)
- macOS (`dmg`)
- Linux (`AppImage`)

To create distributables:

```bash
npm run dist
```

Automated release packaging is documented in [docs/RELEASE.md](docs/RELEASE.md).

## Current implementation notes

- Usage polling uses fallback paths with read-only behavior.
- Snapshots are retained for 30 days with daily pruning.
- Model usage parsing runs async to reduce renderer stalls.
- Provider sidebar and provider catalog are scaffolded for incremental rollout.

## References

- [CodexBar README](https://github.com/steipete/CodexBar)
- [CodexBar Codex provider docs](https://github.com/steipete/CodexBar/blob/main/docs/codex.md)
- [CodexBar provider authoring guide](https://github.com/steipete/CodexBar/blob/main/docs/provider.md)

## Repository docs

- [Architecture](docs/ARCHITECTURE.md)
- [Release and signing](docs/RELEASE.md)
- [Roadmap](docs/ROADMAP.md)
- [Contributing](CONTRIBUTING.md)
