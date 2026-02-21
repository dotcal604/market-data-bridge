## What Changed

<!-- List files created/modified and why -->

## Linked Issue

Fixes #<!-- issue number -->

## Verification

```
<!-- Paste output of verification commands -->
npx tsc --noEmit
npm test
```

## Checklist

- [ ] TypeScript compiles clean (`npx tsc --noEmit`)
- [ ] Tests pass (`npm test`)
- [ ] No `console.log` — Pino logger only
- [ ] Named exports (no default exports)
- [ ] ESM imports with `.js` extensions (backend)
- [ ] Frontend: `"use client"` on interactive components
- [ ] Frontend: dark theme compatible (no white backgrounds)
- [ ] Read `AGENTS.md` before starting

## Agent Info (if applicable)

- **Agent:** <!-- e.g. Copilot, Codex, Antigravity -->
- **Profile:** <!-- e.g. @copilot/frontend-dev -->
