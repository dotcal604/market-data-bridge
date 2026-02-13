# Copilot Instructions for Market Data Bridge

## Project Overview

Market Data Bridge is a single-process Node.js/TypeScript server that bridges Interactive Brokers TWS/Gateway to AI assistants via:
- **MCP Server** (stdio transport) for native Claude Desktop/Code integration
- **REST API** (Express) for ChatGPT custom actions and external tools
- **Next.js Dashboard** (App Router) for admin UI and monitoring

### Core Capabilities
- Real-time market data from Yahoo Finance (always available) and IBKR (when connected)
- Trade execution via IBKR TWS/Gateway with pre-trade risk checks
- Multi-model trade evaluation engine (Claude + GPT-4o + Gemini)
- AI-to-AI collaboration messaging channel
- WebSocket real-time updates for positions, orders, account, and executions

## Tech Stack

### Backend (TypeScript/Node.js)
- **Runtime**: Node.js 18+ with ESM modules (`"type": "module"`)
- **Server**: Express 4 with `@types/express` v5
- **Database**: better-sqlite3 with WAL mode (synchronous API only)
- **Logger**: Pino (no console.log in production code)
- **Validation**: Zod for all external inputs and model outputs
- **IBKR Client**: @stoqey/ib library for TWS/Gateway integration
- **AI SDKs**: @anthropic-ai/sdk, openai, @google/genai

### Frontend (Next.js 14)
- **Framework**: Next.js 14 with App Router
- **Styling**: Tailwind CSS v4 (always dark mode, oklch color space)
- **UI Components**: shadcn/ui primitives (button, card, table, badge, etc.)
- **Tables**: TanStack Table v8
- **Data Fetching**: TanStack Query v5
- **State**: Zustand v5 for client-side stores
- **Charts**: Recharts v3
- **Icons**: Lucide React

## Architecture Constraints

1. **Single process, single port**: Everything runs in one `npm start` on port 3000 (dev: backend 3000, frontend 3001)
2. **No HTTP hops between subsystems**: Eval engine imports Yahoo/IBKR providers as direct function calls, not HTTP
3. **ESM imports only**: All backend imports use `.js` extension in compiled output (`import { foo } from "./bar.js"`)
4. **better-sqlite3 only**: No sql.js, no async DB drivers. WAL mode, synchronous API
5. **Pino logger everywhere**: Use `import { logger } from "../logging.js"`. No console.log
6. **Zod schema validation**: All external inputs (API requests, model outputs) must be validated

## Code Standards

### TypeScript (Backend)
- Strict mode enabled
- No `any` types — use `unknown` + narrowing or explicit interfaces
- Prefer `interface` over `type` for object shapes
- All function parameters and return types must be explicitly typed
- Use `readonly` for arrays/objects that shouldn't be mutated

### Frontend Components
- Every interactive component starts with `"use client"` directive
- Named exports only (no default exports)
- Props interfaces defined in same file or imported from `@/lib/api/types`
- Use `cn()` from `@/lib/utils` for conditional class merging
- Font: `font-mono` for numeric/data values, default sans for labels

### Dark Theme (Mandatory)
- App is always in dark mode (`<html className="dark">`)
- CSS vars use oklch color space in `globals.css`
- Use semantic Tailwind classes: `bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `border-border`
- Score colors: 8+→emerald, 6+→green, 4+→yellow, 2+→orange, <2→red
- Model colors: `gpt-4o=#10b981`, `claude-sonnet=#8b5cf6`, `gemini-flash=#f59e0b`
- Use color utilities from `@/lib/utils/colors` — never hardcode

### Data Fetching (Frontend)
- All API calls go through `@/lib/api/eval-client.ts` or `@/lib/api/account-client.ts`
- React Query hooks in `@/lib/hooks/`
- No direct `fetch()` in components — always use hooks or client wrappers
- Proxy config in `next.config.ts` rewrites `/api/*` → `http://localhost:3000/api/*`

### REST API Conventions
- All endpoints require `X-API-Key` header (enforced by middleware)
- Rate limiting: 100 req/min global, 10/min for orders, 10/min for eval
- Return consistent JSON: `{ data }` on success, `{ error }` on failure
- Use Express Router for route groups
- All query params validated with Zod schemas

### Database (SQLite)
- All tables must have prepared statements defined at init time
- Use parameterized queries — never string interpolation
- WAL mode is set at connection time — don't change it
- Add indexes for columns used in WHERE clauses
- Main tables: evaluations, model_outputs, outcomes, weight_history, positions_snapshot, account_snapshot, orders, executions, journal_entries, collaboration_messages

### Error Handling
- No silent fallbacks — if Yahoo fails, return error, don't return stale data
- Explicit error handling at every boundary
- IBKR disconnection is expected — check connection state before operations
- Log errors with Pino: `error` for failures, `warn` for degraded state, `info` for operations

## Feature Engine Rules

### Pure Functions Only (src/eval/features/)
- No side effects, no network calls, no DB access
- Deterministic math — no randomness, no ML
- Accept numeric/array inputs, return numeric/categorical outputs
- Include formula comments for non-obvious calculations
- Handle edge cases gracefully (division by zero, empty arrays, missing data)

### Model Providers (src/eval/models/providers/)
- Temperature 0 always — reproducible outputs
- Zod schema validation on every response
- Return structured ModelOutput — never raw text
- Timeout: 30s per model call
- Use withRetry() for transient failures only (network errors, rate limits)

### Ensemble Rules
- Ceteris paribus: all 3 models receive identical inputs
- No model sees another model's output
- Weighted mean + quadratic disagreement penalty: `k * spread^2 / 10000`
- Weights loaded from `data/weights.json`, hot-reloaded via fs.watchFile
- Weight updates happen offline (Python analytics script after 50+ outcomes)
- Use `updateWeights()` function — never update weights.json directly

## Financial Constraints

- **Assist discretion mode**: System produces scores and flags. Trader decides. No automated execution
- All time references use Eastern Time (ET), DST-aware
- Trading window: 9:30 AM - 3:55 PM ET (pre-filters block outside)
- Pre-trade risk gate enforced for all orders (max size, max notional, penny stock rejection)
- Quote source must be included in every response (`source: "ibkr" | "yahoo"`)
- R-multiple, ATR context, VWAP context required in eval outputs

## Build & Dev Commands

```bash
# Install dependencies
npm install
cd frontend && npm install && cd ..

# Build backend
npm run build

# Build frontend
cd frontend && npm run build && cd ..

# Dev mode (both servers)
npm run dev

# Type-check backend
npx tsc --noEmit

# Type-check frontend
cd frontend && npx tsc --noEmit

# Run tests
npm test

# Run specific test file
npm test src/ibkr/__tests__/orders.test.ts
```

## Testing Requirements

- Every new endpoint requires: unit test, edge case test, error test
- Feature modules: test with known inputs/outputs, test edge cases
- Model providers: test Zod validation with malformed responses
- No mocking of SQLite — use in-memory DB for tests
- Use Vitest for all tests

## What NOT to Do

- ❌ Do not use `console.log` — use Pino logger
- ❌ Do not add external runtime dependencies without justification
- ❌ Do not make HTTP calls between internal subsystems — use direct imports
- ❌ Do not allow schema drift — Zod schemas are the source of truth
- ❌ Do not store API keys in code — `.env` only
- ❌ Do not modify `src/ibkr/orders.ts` execution logic without explicit approval
- ❌ Do not use default exports for components — named exports only
- ❌ Do not use white backgrounds or light themes — dark mode only
- ❌ Do not mock better-sqlite3 in tests — use in-memory database

## Component Checklist

When creating new frontend components:

1. ✅ Create file in appropriate `frontend/src/components/` subdirectory
2. ✅ Add `"use client"` directive if component is interactive
3. ✅ Define props interface with explicit types
4. ✅ Use shadcn/ui primitives (Card, Badge, Button, etc.)
5. ✅ Use color utilities from `@/lib/utils/colors`
6. ✅ Use formatters from `@/lib/utils/formatters`
7. ✅ Named export (not default export)
8. ✅ Verify with: `cd frontend && npx tsc --noEmit`

## Directory Structure

```
src/
  config.ts           — env vars, ports, API keys
  index.ts            — entry point, starts MCP + REST + IBKR
  logging.ts          — Pino logger setup
  
  ibkr/               — IBKR TWS client modules
  providers/          — Yahoo Finance and market status
  db/                 — SQLite schema and queries
  rest/               — Express server and routes
  mcp/                — MCP server tools
  ws/                 — WebSocket server and broadcaster
  collab/             — AI collaboration channel
  eval/               — Multi-model evaluation engine
    features/         — Pure feature computation functions
    models/           — LLM provider integrations
    ensemble/         — Weighted scoring and consensus
    guardrails/       — Pre/post-trade filters

frontend/
  src/
    app/              — Next.js App Router pages
    components/       — React components (organized by domain)
      layout/         — App shell, sidebar, top bar
      dashboard/      — Dashboard cards and widgets
      eval-table/     — Evaluation history table
      eval-detail/    — Model comparison views
      orders/         — Order entry and management
      account/        — Account and position displays
      ui/             — shadcn/ui primitives
    lib/
      api/            — Typed API clients
      hooks/          — React Query hooks
      stores/         — Zustand state stores
      utils/          — Formatters, colors, helpers
```

## Additional Resources

- **Agent-specific workflows**: See `AGENTS.md` for coding agent conventions and custom agent profiles
- **Orchestration**: See `ORCHESTRATION.md` for GitHub Agent HQ configuration
- **Claude instructions**: See `CLAUDE.md` for MCP-specific Claude instructions
- **System architecture**: See `SYSTEM_CARD.md` for detailed architecture documentation

## Environment Variables

Required in `.env`:
- `IBKR_HOST` — TWS/Gateway host (default: 127.0.0.1)
- `IBKR_PORT` — TWS/Gateway port (default: 7497)
- `REST_PORT` — REST API port (default: 3000)
- `API_KEY` — API authentication key for REST endpoints
- `ANTHROPIC_API_KEY` — Claude API key for eval engine
- `OPENAI_API_KEY` — OpenAI API key for eval engine
- `GOOGLE_API_KEY` — Gemini API key for eval engine

Optional:
- `IBKR_CLIENT_ID` — API client ID (default: 0)
- `LOG_LEVEL` — Pino log level (default: info)
- `FLATTEN_ENABLED` — Auto-flatten schedule enabled (default: false)
- `FLATTEN_TIME` — Auto-flatten time in ET 24h format (default: 15:55)

## Quick Reference

### Import Paths
- Backend: Use `.js` extensions → `import { foo } from "./bar.js"`
- Frontend: Use `@/` aliases → `import { Foo } from "@/components/foo"`

### Logger Usage
```typescript
import { logger } from "../logging.js";

logger.info({ symbol, price }, "Quote fetched");
logger.error({ error: err.message }, "Failed to fetch quote");
```

### Color Utilities
```typescript
import { modelColor, scoreColor, scoreBg } from "@/lib/utils/colors";

const color = modelColor("gpt-4o");  // "#10b981"
const textColor = scoreColor(7.5);   // "text-green-400"
const bgColor = scoreBg(7.5);        // "bg-green-400/10"
```

### Formatters
```typescript
import { formatScore, formatPrice, formatTimestamp } from "@/lib/utils/formatters";

formatScore(7.524);           // "7.52"
formatPrice(150.255);         // "$150.26"
formatTimestamp(1234567890);  // "Feb 13, 2009 6:31 PM"
```
