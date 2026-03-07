# Project Best Practices

> This document is **normative for new and modified code**. Legacy areas of the repo may not yet fully conform.

## 1. Project Purpose

Market Data Bridge is a Node.js/TypeScript service that connects Interactive Brokers (TWS/IB Gateway) to AI assistants through two primary interfaces:

- an **MCP server over stdio** for Claude and other MCP clients
- an **Express REST API** for ChatGPT custom actions and other HTTP clients

It also includes an evaluation/analytics subsystem for ensemble scoring, outcomes, drift, and related analysis, plus a separate Python `analytics/` workspace for research, backtests, and reporting.

## 2. Project Structure

- **`src/`** — primary TypeScript backend (ESM) implementation.
  - **`src/index.ts`** — main entrypoint; parses `--mode`, validates config, manages lifecycle, reconnection, watchers, scheduler startup, readiness state, and graceful shutdown.
  - **`src/rest/`** — Express REST server and route handlers.
  - **`src/mcp/`** — MCP server and tool definitions for stdio transport.
  - **`src/ibkr/`** — Interactive Brokers integration: connection, subscriptions, account data, orders, portfolio, and risk logic.
    - **Safety-critical files** — do not modify without human approval:
      - `src/ibkr/connection.ts`
      - `src/ibkr/risk-gate.ts`
      - `src/ibkr/orders.ts`
      - `src/ibkr/orders_impl/*`
    - `src/ibkr/orders.ts` is a **legacy compatibility proxy**; new code should prefer `src/ibkr/orders_impl/*` when practical.
  - **`src/db/`** — SQLite (`better-sqlite3`) persistence, queries, and reconciliation logic.
  - **`src/eval/`** — eval engine: features, ensemble weights, outcomes, drift, recalibration, and related analytics.
  - **`src/ops/`** — operational concerns such as metrics, readiness, and incident recording.
  - **`src/providers/`** — market/news/provider adapters and fallbacks.
  - **`src/shared/`** — cross-cutting utilities and shared types.
  - **`src/collab/`** — collaboration channel persistence and messaging.
  - **`src/inbox/`** — inbox/event buffer persistence.
  - **Other notable domains**:
    - `src/holly/` — Holly watcher/import domain
    - `src/import/` — inbox watcher / import processing
    - `src/divoom/` — display updater
    - `src/ws/` — websocket functionality
    - `src/config*.ts` — runtime configuration + validation
    - `src/logging.ts` — structured logging setup
- **`frontend/`** — Next.js dashboard/UI, with its own `package.json`, TypeScript config, and frontend tooling.
- **`test/`**, **`tests/`**, **`src/**/__tests__/`** — Vitest tests across multiple folders.
- **`analytics/`** — Python analytics workspace (for example `holly_tearsheets/`, `holly_exit/`, and output/reporting scripts). Treat this as research/ETL code, not runtime bridge code.
- **`scripts/`** — Node scripts for operational checks, backups, deploy helper flows, and schema generation.
- **`docs/`** — architecture notes, runbooks, and decision docs.
- **Key root config**
  - `package.json`
  - `tsconfig.json`
  - `vitest.config.ts`
  - `ecosystem.config.cjs` (PM2)
  - `Dockerfile.prod`
  - `.env*` files (**do not change env var contracts without human approval**)

## 3. Test Strategy

- **Framework**: Vitest (Node environment).
- **Test locations**:
  - `src/**/*.test.ts`
  - `src/**/__tests__/**/*.test.ts`
  - `test/**/*.test.ts`
  - `tests/**/*.test.ts`
- **Philosophy**
  - Prefer **unit tests** for pure logic: parsers, transformers, feature calculations, Zod schemas, helpers.
  - Use **integration tests** for Express routes, DB behavior, and provider/adapter boundaries.
  - Avoid tests that require a live IBKR session; treat IBKR as an external dependency and mock at the adapter boundary.
- **Mocking guidelines**
  - Mock network/provider calls at the boundary, not deep inside business logic.
  - Prefer deterministic fixtures over brittle snapshots for API payloads.
  - For DB tests, use isolated temporary DB paths or in-memory SQLite where supported.
- **Coverage**
  - `npm run test:coverage` uses V8 coverage.
  - Keep coverage meaningful: cover validation errors, edge cases, partial payloads, timeouts, missing fields, invalid symbols, and empty DB states.

## 4. Code Style

### TypeScript / Node

- The repo uses **ESM** (`"type": "module"`). Match local import style in the area you touch, including `.js` extensions where required by the build/runtime pattern.
- TypeScript is **strict**. Keep boundary types explicit.
- Prefer `unknown` + narrowing over `any` for external input.
- Keep functions small, composable, and side effects isolated.
- Prefer **named exports** in application code. Config files may use `export default` when that is the surrounding tool convention.

### Validation

- Use **Zod** for external inputs:
  - REST request bodies / query params / path params
  - MCP tool args
  - env-derived config
- Validate early and return structured errors.

### Logging

- Use **Pino** via the repo logger.
- **Never write to stdout** outside protocol output.
- Avoid `console.*` in normal runtime code. Rare bootstrap or transport-critical **stderr-only** diagnostics are acceptable when necessary to protect MCP stdio.
- Log with context objects, for example:

```ts
logger.info({ symbol, mode }, "Fetching quote");
```

### Error handling

- Do not swallow errors silently.
- For expected operational failures (IBKR down, provider timeout, unavailable upstream), log at `warn` and degrade gracefully where possible.
- For programmer errors or invariants, log at `error` or `fatal` and let process-level handlers decide recovery.
- Route handlers returning 500 should also log server-side context; do not send silent 500 responses.
- Keep error messages safe: no secrets, tokens, or sensitive account identifiers.

### Async / lifecycle

- Prefer `async`/`await`.
- Ensure background loops, watchers, subscriptions, and schedulers have explicit stop hooks used during shutdown.
- Be explicit about retry/backoff behavior; do not create tight reconnect loops.

### Naming

- Follow local conventions in the touched subtree.
- Files/directories: prefer kebab-case where that convention exists.
- Functions: `camelCase` verbs (`getQuote`, `runScreenerWithQuotes`).
- Types/interfaces: `PascalCase`.
- Constants: `SCREAMING_SNAKE_CASE` only for real constants.

## 5. Common Patterns

### Multi-mode runtime

The backend can run in:

- `mcp`
- `mcp-readonly`
- `rest`
- `both`

New features must respect mode boundaries:

- Keep MCP processes lean.
- Avoid schedulers, watchers, duplicate automation, or long-running background loops in MCP-only modes.
- `mcp-readonly` should behave as analytics/local-data oriented mode with no IBKR connect attempt.
- Background automation belongs in the always-on bridge process (`rest` / `both`).

### Adapter/provider boundary

Treat IBKR, Yahoo Finance, news feeds, and other external services as providers/adapters. Keep provider-specific behavior separate from core transforms and business logic.

### Graceful degradation

When IBKR is unavailable, functionality should fall back where possible (for example, Yahoo-based market data) instead of taking down the entire bridge.

### Operational hygiene

- Prefer readiness/health endpoints and structured incident recording.
- Centralize timers, watchers, subscriptions, and schedulers so shutdown can stop them cleanly.

### Persistence discipline

- Use parameterized queries / prepared statements with `better-sqlite3`.
- Keep DB writes idempotent where practical, especially around ingestion, reconciliation, and repeated sync operations.

## 6. Do's and Don'ts

### Do

- Validate all external inputs with Zod at the boundary (REST + MCP).
- Keep MCP stdio output clean: protocol on stdout, diagnostics/logging off stdout.
- Keep long-running background automation only in the always-on bridge process.
- Structure logs with useful context and avoid leaking secrets.
- Add tests for edge cases: timeouts, partial payloads, market-closed behavior, invalid symbols, empty DB, and fallback behavior.
- Keep strict TypeScript compatibility; `npm run build` should pass.
- Update docs/runbooks when behavior or operational expectations change.

### Don't

- Don't modify order execution, risk gates, IBKR connection management, or env var contracts without human approval.
- Don't introduce new dependencies without human approval.
- Don't use `console.log`; it can corrupt MCP stdio transport.
- Don't make REST endpoints require a live TWS session when a fallback is viable.
- Don't add watchers, timers, or schedulers without shutdown/stop hooks.
- Don't couple runtime bridge behavior directly to ad hoc Python analytics scripts.

## 7. Tools & Dependencies

### Runtime (Node / TS)

Representative runtime dependencies include:

- **Express** — REST API
- **@modelcontextprotocol/sdk** — MCP server + stdio transport
- **@stoqey/ib** — IBKR API client
- **better-sqlite3** — persistence
- **zod** — validation
- **pino** — structured logging
- **ws** — websocket support
- **dotenv** — env config
- **openai** / **@anthropic-ai/sdk** / **@google/genai** — model provider integrations
- **chart.js** / **chartjs-node-canvas** / **@napi-rs/canvas** / **sharp** — rendering + graphics utilities

### Testing

- **Vitest** — unit/integration tests
- **supertest** — HTTP route testing

### Frontend

- Next.js app in `frontend/`
- Static export is supported via `FRONTEND_STATIC_EXPORT=1`

### Common commands

- Install: `npm install`
- Build backend: `npm run build`
- Build backend + frontend: `npm run build:all`
- Test: `npm test`
- Coverage: `npm run test:coverage`
- Dev (API + UI): `npm run dev`
- Dev API only: `npm run dev:api`
- Dev UI only: `npm run dev:ui`
- Start MCP: `npm run start:mcp`
- Start MCP readonly: `npm run start:mcp-readonly`
- Start REST only: `npm run start:rest`
- Prod: `npm run start:prod`

> **Note:** `npm run dev` / `npm run dev:api` execute compiled output from `build/`, not a TypeScript watch runner. If you edit `src/`, rebuild first or run a separate TypeScript watch process.

## 8. Other Notes

### Authority / safety rules

- Never touch execution-critical files (orders, risk gate, connection) without human approval.
- Dependency additions and environment variable contract changes require human approval.

### MCP transport constraint

Stdout is reserved for MCP protocol traffic. Accidental stdout logging can break tool calls. Keep diagnostics off stdout.

### Mode correctness

Ensure new code behaves correctly under:

- `--mode mcp-readonly` — no IBKR connect
- `--mode mcp` — no background automation
- `--mode rest` / `--mode both` — background automation allowed where appropriate

### Docs are first-class

Architecture notes and ops runbooks live in `docs/`. Update them when changing runtime behavior, operational procedures, or failure handling.

### Python analytics is separate

The `analytics/` folder has its own requirements and conventions. Keep runtime server behavior decoupled from analytics notebooks/scripts unless there is an explicit, reviewed integration path.
