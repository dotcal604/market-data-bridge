# Market Data Bridge — Agent Rules

## Project Overview

Single-process Node.js/TypeScript server (port 3000) + Next.js dashboard (port 3001 in dev):
- Real-time market data (Yahoo Finance always, IBKR when connected)
- Trade execution via IBKR TWS/Gateway
- Multi-model trade evaluation engine (Claude + GPT-4o + Gemini)
- AI-to-AI collaboration channel
- MCP server (Claude) + REST API (ChatGPT/external agents)
- Admin dashboard (Next.js 14, App Router) in `frontend/`

## Architecture Constraints

1. **Single process, single port** — everything runs in one `npm start` on port 3000
2. **No HTTP hops between subsystems** — eval engine imports Yahoo/IBKR providers directly as function calls, not HTTP requests
3. **better-sqlite3 only** — WAL mode, synchronous API. No sql.js, no async DB drivers
4. **ESM modules** — `"type": "module"` in package.json. All imports use `.js` extension in compiled output
5. **Pino logger** — use `import { logger } from "../logging.js"`. No console.log in production code
6. **Express 4** — with `@types/express` v5 (stricter `req.query` types). Use `qs()` helper for query params
7. **Zod for runtime validation** — all external inputs (API requests, model outputs) validated with Zod schemas

## Directory Structure

```
src/
  config.ts           — env vars, ports, API keys
  index.ts            — entry point, starts MCP + REST + IBKR
  logging.ts          — Pino logger setup
  scheduler.ts        — periodic account/position snapshots
  suppress-stdout.ts  — MCP stdout isolation

  ibkr/               — IBKR TWS client modules
    connection.ts     — IBApi connection manager
    account.ts        — account/positions/PnL
    orders.ts         — order placement + management
    marketdata.ts     — real-time quotes
    contracts.ts      — contract resolution
    risk-gate.ts      — pre-trade risk checks

  providers/
    yahoo.ts          — Yahoo Finance wrapper (getQuote, getHistoricalBars, getStockDetails)
    status.ts         — market session detection

  db/
    database.ts       — SQLite schema + prepared statements + query helpers
    reconcile.ts      — boot-time order reconciliation

  rest/
    server.ts         — Express server, middleware, route mounting
    routes.ts         — all REST endpoint handlers
    openapi.ts        — OpenAPI 3.1 spec generator

  mcp/
    server.ts         — MCP tool definitions (stdio transport)

  collab/
    store.ts          — AI-to-AI collaboration message store

  eval/               — Multi-model trade evaluation engine
    types.ts          — shared BarData/QuoteData/StockDetails interfaces
    config.ts         — eval-specific env config (API keys, model names, thresholds)
    retry.ts          — withTimeout() + withRetry()

    features/
      types.ts        — FeatureVector (27 fields), ModelFeatureVector, stripMetadata()
      compute.ts      — feature orchestrator (direct Yahoo provider calls)
      rvol.ts         — relative volume vs 20-day average
      vwap.ts         — VWAP deviation percentage
      spread.ts       — bid-ask spread percentage
      gap.ts          — gap from prior close
      range-position.ts — position within day's range
      atr.ts          — 14-period ATR + ATR as % of price
      extension.ts    — price extension in ATR units
      float-rotation.ts — volume / estimated float
      volume-acceleration.ts — last bar vol / prev bar vol
      liquidity.ts    — small/mid/large classification
      volatility-regime.ts — low/normal/high classification
      time-classification.ts — time of day + minutes since open (DST-aware)
      market-alignment.ts — SPY/QQQ alignment

    models/
      types.ts        — ModelId, ModelOutput, ModelEvaluation
      schema.ts       — Zod ModelOutputSchema for validating LLM responses
      prompt.ts       — system prompt + buildUserPrompt() + hashPrompt()
      runner.ts       — Promise.allSettled orchestrator for 3 models in parallel
      providers/
        claude.ts     — Anthropic SDK (@anthropic-ai/sdk)
        openai.ts     — OpenAI SDK (openai)
        gemini.ts     — Google GenAI SDK (@google/genai)

    ensemble/
      types.ts        — EnsembleWeights, EnsembleScore
      scorer.ts       — weighted mean + quadratic disagreement penalty
      weights.ts      — load data/weights.json + fs.watchFile hot-reload

    guardrails/
      prefilter.ts    — pre-trade structural filters (before model API calls)
      behavioral.ts   — post-ensemble checks (trading window, loss streak, disagreement)

    routes.ts         — Express router mounted at /api/eval

frontend/                 — Next.js 14 dashboard (App Router)
  next.config.ts          — proxy /api/* to backend on port 3000
  src/
    app/
      page.tsx            — dashboard home (stats cards + recent evals)
      evals/
        page.tsx          — eval history (TanStack Table, sortable)
        [id]/page.tsx     — eval detail (3-model comparison)
      weights/
        page.tsx          — ensemble weights display
    components/
      layout/             — app-shell.tsx, sidebar.tsx, top-bar.tsx
      dashboard/          — stats-cards.tsx, recent-evals-mini.tsx
      eval-table/         — eval-table.tsx, eval-table-columns.tsx
      eval-table/         — eval-table.tsx, eval-table-columns.tsx, eval-filters.tsx
      eval-detail/        — model-card.tsx, model-comparison.tsx, ensemble-summary.tsx,
                            guardrail-badges.tsx, feature-table.tsx, outcome-panel.tsx, outcome-form.tsx
      model-stats/        — model-comparison.tsx, stats-summary.tsx
      shared/             — score-badge.tsx, direction-badge.tsx, model-avatar.tsx, export-button.tsx
      analytics/          — score-scatter.tsx, feature-radar.tsx, time-of-day-chart.tsx
      weights/            — weight-sliders.tsx
      ui/                 — shadcn/ui primitives (button, card, table, badge, etc.)
    lib/
      api/
        types.ts          — TypeScript interfaces mirroring backend schemas
        eval-client.ts    — typed fetch wrappers for /api/eval endpoints
      hooks/
        use-evals.ts      — React Query hooks (useEvalHistory, useEvalDetail, useEvalStats, etc.)
      stores/
        eval-filters.ts   — Zustand store for eval history filter state
      utils/
        formatters.ts     — formatScore, formatPrice, formatMs, formatTimestamp, etc.
        colors.ts         — scoreColor, scoreBg, modelColor, directionColor, etc.
        export.ts         — exportToCsv, exportToJson
      providers.tsx       — QueryClientProvider wrapper
      utils.ts            — cn() helper (clsx + tailwind-merge)
```

## Build & Dev

```bash
# Backend: build TypeScript
npm run build

# Frontend: install deps + build
cd frontend && npm install && npm run build

# Dev mode (both): backend on :3000, frontend on :3001
npm run dev

# Frontend type-check only (no build output)
cd frontend && npx tsc --noEmit
```

## Code Standards

### Frontend (frontend/src/)

#### Stack
- **Next.js 14+** — App Router, `"use client"` for interactive components
- **Tailwind CSS v4** — utility-first, dark theme via `.dark` class on `<html>`
- **shadcn/ui** — import from `@/components/ui/*` (already installed: button, card, table, badge, input, skeleton, tabs, tooltip, dialog, select, separator)
- **TanStack Table v8** — `useReactTable` + `getCoreRowModel` + `getSortedRowModel`
- **TanStack Query v5** — `useQuery` with `queryKey` arrays, `refetchInterval` for polling
- **Recharts v3** — `ResponsiveContainer` wrapper required, dark theme: transparent bg, `text-muted-foreground` for axis labels
- **Zustand v5** — lightweight client stores (filter state, etc.)
- **Lucide React** — icon library, import individual icons

#### Component Conventions
- Every interactive component starts with `"use client"` directive
- Named exports only (no default exports for components)
- Props interface defined in same file or imported from `@/lib/api/types`
- Use `cn()` from `@/lib/utils` for conditional class merging
- Font: `font-mono` for numeric/data values, default sans for labels

#### Dark Theme (mandatory)
- App is always in dark mode (`<html className="dark">`)
- CSS vars use oklch color space — defined in `globals.css` under `.dark {}`
- Use semantic Tailwind classes: `bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `border-border`
- For custom colors: `text-emerald-400` (positive/long), `text-red-400` (negative/short), `text-yellow-400` (neutral)
- Score colors: 8+→emerald, 6+→green, 4+→yellow, 2+→orange, <2→red (see `lib/utils/colors.ts`)

#### Color Constants
- Model colors: `gpt-4o=#10b981`, `claude-sonnet=#8b5cf6`, `gemini-flash=#f59e0b`
- Use `modelColor()` from `@/lib/utils/colors` — do not hardcode

#### Data Fetching
- All API calls go through `@/lib/api/eval-client.ts` (typed wrappers)
- React Query hooks in `@/lib/hooks/use-evals.ts`
- Proxy config in `next.config.ts` rewrites `/api/*` → `http://localhost:3000/api/*`
- No direct `fetch()` in components — always use hooks or eval-client

#### New Component Checklist
1. Create file in appropriate `components/` subdirectory
2. Add `"use client"` if interactive
3. Define props interface with explicit types
4. Use shadcn primitives (Card, Badge, etc.) for structure
5. Use color utilities from `@/lib/utils/colors`
6. Use formatters from `@/lib/utils/formatters`
7. Verify: `cd frontend && npx tsc --noEmit`

### TypeScript (Backend)
- Strict mode enabled
- No `any` types — use `unknown` + narrowing or explicit interfaces
- Prefer `interface` over `type` for object shapes
- All function parameters and return types must be explicitly typed
- Use `readonly` for arrays/objects that shouldn't be mutated

### Feature Engine (src/eval/features/)
- **Pure functions only** — no side effects, no network calls, no DB access
- Deterministic math — no randomness, no ML
- Accept numeric/array inputs, return numeric/categorical outputs
- Include formula comments for non-obvious calculations
- Handle edge cases (division by zero, empty arrays, missing data) gracefully

### Model Providers (src/eval/models/providers/)
- Temperature 0 always — reproducible outputs
- Zod schema validation on every response
- Return structured ModelOutput — never raw text
- Timeout: 30s per model call
- Use withRetry() for transient failures only (network errors, rate limits)

### Database (src/db/)
- All new tables must have prepared statements defined at init time
- Use parameterized queries — never string interpolation for SQL
- WAL mode is set at connection time — don't change it
- Add indexes for any column used in WHERE clauses
- Eval tables: evaluations, model_outputs, outcomes, weight_history

### REST API (src/rest/)
- All endpoints require `X-API-Key` header (enforced by middleware)
- Rate limiting: 100 req/min global, 10/min for orders, 10/min for eval
- Return consistent JSON shape: `{ data }` on success, `{ error }` on failure
- Use Express Router for route groups

### Error Handling
- No silent fallbacks — if Yahoo fails, return an error, don't silently return stale data
- Explicit error handling required at every boundary
- IBKR disconnection is expected — check connection state before operations
- Log errors with Pino at appropriate levels (error for failures, warn for degraded, info for ops)

## Financial Constraints

- **Assist discretion mode** — the system produces scores and flags. The trader decides. No automated execution based on eval scores
- All time references use Eastern Time (ET), DST-aware
- Trading window: 9:30 AM - 3:55 PM ET (pre-filters block outside this)
- Pre-trade risk gate enforced for all orders (max size, max notional, penny stock rejection)
- Quote source must be included in every response (`source: "ibkr" | "yahoo"`)
- R-multiple, ATR context, VWAP context required in eval outputs

## Ensemble Rules

- Ceteris paribus: all 3 models receive identical inputs (same prompt, same features, same temperature)
- No model sees another model's output
- Weighted mean + quadratic disagreement penalty: `k * spread^2 / 10000`
- Majority voting + minimum score threshold (40)
- Weights loaded from `data/weights.json`, hot-reloaded via fs.watchFile
- Weight updates happen offline (Python analytics script after 50+ outcomes)

## Testing Requirements

- Every new endpoint requires: unit test, edge case test, error test
- Feature modules: test with known inputs/outputs, test edge cases (zero, negative, empty)
- Model providers: test Zod validation with malformed responses
- No mocking of SQLite — use in-memory DB for tests

## What NOT to Do

- Do not modify `src/ibkr/orders.ts` execution logic without explicit approval
- Do not add external runtime dependencies without justification
- Do not use `console.log` — use Pino logger
- Do not make HTTP calls between internal subsystems — use direct imports
- Do not allow schema drift — Zod schemas are the source of truth
- Do not auto-merge any PR — human review required
- Do not store API keys in code — `.env` only

## Agent-Specific Notes

> All agents (Copilot, Codex) read this `AGENTS.md` file automatically. The conventions above apply to all.
> Orchestration is managed via **GitHub Agent HQ** — see `ORCHESTRATION.md` and `.github/agents/` for custom agent profiles.

### Key Points for All Agents

- **Two package.json files** — root is backend (Express/TypeScript), `frontend/` is Next.js. Install both with `npm install && cd frontend && npm install`.
- **ESM imports** — backend uses `.js` extensions in imports (`import { foo } from "./bar.js"`). Frontend uses bare paths.
- **Frontend paths** — components live in `frontend/src/components/`, not `src/components/`
- **shadcn/ui** — already installed. Import from `@/components/ui/*`. Don't re-install.
- **Recharts** — already installed in frontend. Import from `recharts`.
- **Dark theme always** — use `bg-card`, `text-muted-foreground`, semantic Tailwind classes. No white backgrounds.
- **Named exports only** — `export function Foo()`, not `export default function Foo()`

### OpenAI Codex (Cloud Agent)

Codex runs tasks in cloud sandboxes at [chatgpt.com/codex](https://chatgpt.com/codex). It reads this `AGENTS.md` file automatically via its discovery chain.

**Environment setup** (configured at chatgpt.com/codex/settings/environments):
```bash
npm install && cd frontend && npm install && cd ..
```

**Strengths:** Long-running tasks (7+ hours), parallel task execution, GPT-5.2-Codex model, GitHub integration (@codex on issues/PRs).

**Historical note:** Early Codex (PRs #3, #23) had broken PR bodies and missing env setup. Current Codex reads AGENTS.md, supports custom setup scripts, and uses GPT-5.2-Codex.

### GitHub Copilot (Coding Agent)

Copilot creates draft PRs from assigned issues. Works best with detailed issue specs (exact file paths, props interfaces, acceptance criteria).

**Trigger:** Assign Copilot to an issue via GitHub web UI, or use custom agents via `@copilot/{agent-name}`.

**Note:** Copilot's GitHub Actions firewall blocks `fonts.googleapis.com` — cosmetic only, builds succeed.

### Verification Commands

After writing code, verify with:

```bash
# Frontend components
cd frontend && npx tsc --noEmit

# Backend modules
npx tsc --noEmit
```

### PR Conventions

When creating PRs, include in the body:
- **What changed**: files created/modified
- **Fixes #N**: link to the issue being resolved
- **Verification**: output of `tsc --noEmit` showing clean compile
