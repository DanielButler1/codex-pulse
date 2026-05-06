# Release And Signing

## Packaging targets

The app is configured to build installers for:

- Windows: NSIS `.exe`
- macOS: `.dmg`
- Linux: `.AppImage`

The GitHub Actions workflow at [`.github/workflows/release.yml`](../.github/workflows/release.yml) builds all three on tag pushes and can also be run manually.

Installed builds are tray-first, start hidden by default, and register start-at-login so the watcher/logger can keep running in the background without opening the window.

## Local packaging

```bash
npm ci
npm run typecheck
npm run build
npm run dist
```

On Windows, the installer is written to `release/<version>/`.

## Code signing guidance

### Windows

Use one of:

- A standard code-signing certificate via `CSC_LINK` and `CSC_KEY_PASSWORD`
- Azure Trusted Signing if you already have that pipeline

Recommended environment variables for CI:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`

Unsigned installers will still build, but SmartScreen warnings are more likely.

### macOS

Use Apple Developer signing and notarization.

Recommended environment variables:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Without signing and notarization, macOS releases will be blocked or warn aggressively on other machines.

### Linux

Linux AppImages usually do not require signing for basic distribution.
If you later want signed packages, add a Linux signing step separately.

## Icon guidance

Do not ship the Codex logo as the app icon.
Use a neutral brand mark for Codex Pulse, such as:

- a custom `CP` monogram
- a simple pulse waveform
- a neutral monitor/agent glyph

Once the final icon is chosen, generate a proper multi-platform icon pack for:

- Windows `.ico`
- macOS `.icns`
- Linux `.png`

Then wire that asset into the Electron packaging config.

## Release process

1. Bump `package.json` version.
2. Tag the release, for example `v0.0.1` or `v0.0.0-beta.1`.
3. Push the tag.
4. GitHub Actions builds all installers and publishes them to the GitHub Release.
