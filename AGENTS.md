# Market Data Bridge — Agent Rules

## Project Overview

Single-process Node.js/TypeScript server (port 3000) providing:
- Real-time market data (Yahoo Finance always, IBKR when connected)
- Trade execution via IBKR TWS/Gateway
- Multi-model trade evaluation engine (Claude + GPT-4o + Gemini)
- AI-to-AI collaboration channel
- MCP server (Claude) + REST API (ChatGPT/Codex)

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
        gemini.ts     — Google GenAI SDK (@google/generative-ai)

    ensemble/
      types.ts        — EnsembleWeights, EnsembleScore
      scorer.ts       — weighted mean + quadratic disagreement penalty
      weights.ts      — load data/weights.json + fs.watchFile hot-reload

    guardrails/
      prefilter.ts    — pre-trade structural filters (before model API calls)
      behavioral.ts   — post-ensemble checks (trading window, loss streak, disagreement)

    routes.ts         — Express router mounted at /api/eval
```

## Code Standards

### TypeScript
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
