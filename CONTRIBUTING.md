# Contributing

## Setup

```bash
npm install
npm run dev
```

## Validation

```bash
npm run typecheck
npm run build
```

## Principles

- Keep provider logic isolated.
- Never log or display tokens/secrets.
- Prefer additive changes over broad rewrites.
- For parser changes, add fixtures/tests where practical.

## Pull requests

- Describe user-facing impact.
- Include screenshots/GIFs for renderer changes.
- Note any new provider source paths and fallback ordering.
- Call out security implications explicitly.
