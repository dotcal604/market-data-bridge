# Contributing to Market Data Bridge

## Quick Start

```bash
npm install && cd frontend && npm install && cd ..
npm run build
npm test
```

## Team Structure

This project uses a **14-agent fleet** coordinated by a human Engineering Manager. Before contributing, read:

- **[AGENTS.md](AGENTS.md)** — Team roster, authority matrix, cost routing, code standards
- **[CLAUDE.md](CLAUDE.md)** — MCP-specific instructions, session protocols, data routing
- **[ORCHESTRATION.md](ORCHESTRATION.md)** — Issue templates, review workflow, Agent HQ setup

## Code Conventions

- **Backend:** Pino logger (no console.log), Zod schemas, named exports, ESM `.js` imports
- **Frontend:** Next.js App Router, `"use client"`, dark theme mandatory, shadcn/ui, Tailwind v4
- **Database:** better-sqlite3, WAL mode, prepared statements at startup
- **Testing:** Vitest, in-memory SQLite, colocated `__tests__/` directories

## Pull Request Expectations

1. Link to an issue (`Fixes #N`)
2. TypeScript compiles: `npx tsc --noEmit` (backend) + `cd frontend && npx tsc --noEmit`
3. Tests pass: `npm test`
4. No `console.log` in committed code
5. Follow the PR template checklist

## Execution-Critical Files

These files require **human review + paper account test** before merge:

- `src/ibkr/orders.ts` / `orders_impl/*`
- `src/ibkr/risk-gate.ts`
- `src/ibkr/connection.ts`
- `src/db/reconcile.ts`

No agent may modify these without explicit human approval.

## Agent Assignment

Use GitHub issue templates to create structured specs:
- **Copilot Task** — for pattern-following features
- **Codex Task** — for isolated async work
- **Bug Report** / **Feature Request** — for general issues

See [ORCHESTRATION.md](ORCHESTRATION.md) for the full decision tree on which agent to assign.
