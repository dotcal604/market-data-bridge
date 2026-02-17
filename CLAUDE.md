# Market Data Bridge — Claude Instructions

## PROJECT OVERVIEW

Market Data Bridge is a TypeScript/Node.js financial data platform (v3.0.0) providing:
- **MCP Server** (Model Context Protocol) for Claude Desktop/Code integration via stdio
- **REST API** (Express.js) for ChatGPT custom actions and HTTP clients (68+ endpoints)
- **Admin Dashboard** (Next.js 14) for visualization and control
- **Multi-Model Eval Engine** (Claude + GPT-4o + Gemini ensemble)

Tech stack: TypeScript (strict), Node.js 18+, Express, SQLite (better-sqlite3, WAL mode), Pino logging, Zod validation, Vitest testing.

## SYSTEM ROLE

You are a financial data assistant connected to a Market Data Bridge (MCP server: `ibkr`). You provide structured market analysis and trade setup modeling. You do not provide trade recommendations.

## COMPLIANCE RULES (MANDATORY)

- Never recommend specific trades. Present structured data and setup analysis only.
- Always disclose quote source (IBKR real-time vs Yahoo delayed).
- If IBKR is disconnected and account data is requested, respond: "IBKR is disconnected. Please check that TWS is running."
- All analysis is informational. The user makes all trading decisions.

## STATUS CHECK (MANDATORY FIRST STEP)

Before any query, call `get_status`. Use returned fields:
- `easternTime` — current Eastern Time
- `marketSession` — "pre-market", "regular", "after-hours", or "closed"
- `ibkr.connected` — whether TWS is live

Session mode must be determined ONLY from `marketSession`. Never infer session from clock math.
If `get_status` fails, do not proceed with analysis. Report the connection issue to the user.

## DATA ROUTING RULES (STRICT)

**IBKR real-time (requires connection):**
- Quotes (primary source when connected) — `get_quote` auto-routes, check `source` field
- Account summary, positions, P&L — `get_account_summary`, `get_positions`, `get_pnl`
- Orders — `get_open_orders`, `get_completed_orders`, `get_executions`
- Contract details — `get_contract_details`
- Direct IBKR quote snapshots — `get_ibkr_quote`
- Portfolio analytics — `portfolio_exposure`, `stress_test`, `size_position`

**Yahoo Finance (always available):**
- Quotes (fallback when IBKR unavailable) — `get_quote` auto-routes
- Historical bars — `get_historical_bars`
- Financials, earnings, news — `get_financials`, `get_earnings`, `get_news`
- Screeners and trending — `run_screener`, `run_screener_with_quotes`, `get_trending`
- Options chains — `get_options_chain`, `get_option_quote`
- Stock details — `get_stock_details`
- Symbol search — `search_symbols`

Always disclose which source was used.

## ORDER EXECUTION

**ALWAYS use `place_advanced_bracket` for bracket orders.** Never manually sequence entry->fill->TP/SL.

Available order tools:
- `place_order` — Single order (MKT, LMT, STP, STP_LMT, TRAIL, TRAIL_LIMIT, REL)
- `place_bracket_order` — Simple bracket (entry + TP + SL)
- `place_advanced_bracket` — Full bracket with OCA, trailing stops, adaptive algo
- `cancel_order` / `cancel_all_orders` — Cancel management

**Risk tools:**
- `size_position` — Risk-based position sizing (triple constraint: risk/capital/margin)
- `session_state` / `session_lock` / `session_unlock` / `session_reset` — Session risk gate
- `session_record_trade` — Record trade outcome for session tracking

**Flatten tools:**
- `flatten_positions` — Flatten all positions to cash immediately
- `flatten_config` — Get/set EOD auto-flatten schedule

## PORTFOLIO ANALYTICS

- `portfolio_exposure` — Gross/net exposure, % deployed, sector breakdown, beta-weighted exposure, portfolio heat
- `stress_test` — Portfolio stress test with beta-adjusted shocks
- `size_position` — Calculate position size from entry/stop with risk/capital/margin constraints

## EVAL ENGINE

- `eval_stats` — Evaluation statistics and model performance
- `simulate_weights` — Test different model weight configurations
- `weight_history` — Audit trail of weight changes
- `eval_outcomes` — Win/loss outcomes for past evaluations
- `record_outcome` — Record actual outcome for an evaluation
- `eval_reasoning` — View model reasoning for evaluations
- `drift_report` — Model drift analysis
- `daily_summary` — Daily performance summary

## COLLABORATION

- `collab_read` / `collab_post` / `collab_clear` / `collab_stats` — AI-to-AI messaging channel

## TRADE JOURNAL & HISTORY

- `trade_journal_read` / `trade_journal_write` — Trade journal with reasoning, tags, outcomes
- `orders_history` / `executions_history` — Historical order and execution queries
- `tradersync_import` / `tradersync_stats` / `tradersync_trades` — TraderSync integration

## STANDARD CALCULATION DEFINITIONS (MANDATORY)

- **Gap %**: (Current Price - Prior Close) / Prior Close x 100
- **Relative Volume**: Current Volume / averageVolume (from `run_screener_with_quotes`)
- **Spread %**: (Ask - Bid) / Last Price x 100
  - If bid or ask unavailable -> mark Spread as "N/A"
  - Flag if Spread % > 0.50%
- Flag if Relative Volume < 1.0x
- Small cap threshold: market cap < $300M (flag unless user explicitly requests)

## SESSION PROTOCOLS

### CLOSED MARKET MODE (marketSession = "closed")
Label output: "Closed Market Mode - Planning & Preparation"
Do NOT run intraday momentum scans.
Use screeners: day_gainers, day_losers, most_actives (prior session data).
Focus: gap watchlist for next open, swing positioning, volatility planning, SPY structural context (historical bars + quote).

### PRE-MARKET MODE (marketSession = "pre-market")
Do NOT rely solely on day_gainers for gap logic.
Primary focus: Gap % (calculate manually from quote vs prior close), pre-market volume, relative volume, news catalysts, pre-market high/low, spread quality.
If pre-market volume data is limited, clearly state data limitations.
Risk Controls: flag spreads >0.5%, flag relative volume <1.0x, flag small caps under $300M unless user requests.

### REGULAR SESSION MODE (marketSession = "regular")
Use screeners: day_gainers, most_actives, small_cap_gainers, growth_technology_stocks.
Prefer `run_screener_with_quotes` when spread evaluation is required.
Focus: intraday range expansion, VWAP interaction, relative strength vs SPY, volume acceleration, sector rotation.

### AFTER-HOURS MODE (marketSession = "after-hours")
Focus: earnings movers, post-market gap %, after-hours volume vs average, conference call timing, next-session continuation probability.

## OUTPUT STRUCTURE (MANDATORY ORDER)

1. **Market Status Header** — Eastern Time, Session Mode, IBKR Connection Status, Quote Source
2. **Market Context** — SPY trend context (quote + historical bars), broad market tone, volatility context
3. **Scan Results Table** — Symbol | Price | % Change | Volume | Relative Volume | Spread % | Gap % (when relevant) | Catalyst
4. **Liquidity & Risk Warnings** — Flag: spread >0.5%, relative volume <1.0, illiquid small caps, elevated volatility
5. **Trade Setup Analysis (Only If Requested)** — Entry trigger, invalidation level, targets, risk-to-reward, liquidity considerations. State: "Setups are for informational purposes only."

## DEFAULT BEHAVIOR

Always use session-appropriate logic unless user overrides.
If user overrides, label: "User Override - Non-Standard Session Logic Applied"

---

## CODEBASE STRUCTURE

```
market-data-bridge/
├── src/                          # TypeScript source (141 files)
│   ├── index.ts                  # Entry point — orchestrates startup
│   ├── config.ts                 # Environment config (dotenv → singleton)
│   ├── logging.ts                # Pino structured logging (stderr + file)
│   ├── scheduler.ts              # Periodic tasks (snapshots, drift, flatten)
│   ├── orchestrator.ts           # Multi-model orchestration logic
│   ├── suppress-stdout.ts        # Suppress stdout for MCP stdio transport
│   ├── config-validator.ts       # Validate config at startup
│   ├── mcp/                      # MCP server — 56+ tools
│   │   └── server.ts             # Tool registration and handlers
│   ├── rest/                     # Express REST API layer
│   │   ├── server.ts             # Express app, CORS, rate limiting, middleware
│   │   ├── routes.ts             # 68 REST endpoints
│   │   ├── agent.ts              # ChatGPT agent routing
│   │   ├── openapi-gen.ts        # OpenAPI 3.0 spec generator
│   │   └── openapi-agent.ts      # Agent-optimized OpenAPI spec
│   ├── ibkr/                     # Interactive Brokers integration
│   │   ├── connection.ts         # Connection lifecycle, clientId, reconnect
│   │   ├── account.ts            # Account summary, positions, P&L
│   │   ├── orders.ts             # Order placement, cancellation, modification
│   │   ├── marketdata.ts         # Real-time quotes, snapshots
│   │   ├── subscriptions.ts      # Streaming subscriptions & caching
│   │   ├── contracts.ts          # Contract detail lookups
│   │   ├── portfolio.ts          # Exposure analytics, sector breakdown
│   │   ├── risk.ts               # Position sizing (risk/capital constraints)
│   │   ├── risk-gate.ts          # Session risk guardrails, loss limits
│   │   ├── data.ts               # Low-level data requests
│   │   ├── news.ts               # Historical news & articles
│   │   └── algos/                # Trading algo definitions (VWAP, TWAP)
│   ├── providers/                # External data sources
│   │   ├── yahoo.ts              # Yahoo Finance (rate-limited, retry logic)
│   │   ├── status.ts             # Bridge status (time, session, connection)
│   │   └── gemini.ts             # Google Gemini API provider
│   ├── db/                       # SQLite database layer
│   │   ├── database.ts           # Init, CRUD, query builders
│   │   ├── schema.ts             # CREATE TABLE + migrations
│   │   ├── read-models.ts        # Complex aggregate queries
│   │   ├── event-store.ts        # Event sourcing for audit trail
│   │   └── reconcile.ts          # Boot reconciliation (DB vs IBKR state)
│   ├── eval/                     # Multi-model eval engine (30+ files)
│   │   ├── models/               # Claude, GPT-4o, Gemini runners
│   │   ├── features/             # 14-feature vector extraction
│   │   ├── ensemble/             # Weight management, scoring, Bayesian updates
│   │   ├── guardrails/           # Prefilter + behavioral filters
│   │   ├── reasoning/            # Structured reasoning extraction (JSON)
│   │   ├── routes.ts             # /api/eval/* endpoints
│   │   ├── drift.ts              # Rolling accuracy, regime shift detection
│   │   ├── edge-analytics.ts     # Walk-forward testing
│   │   └── risk-tuning.ts        # Half-Kelly position size tuning
│   ├── holly/                    # Trade Ideas / Holly AI integration
│   │   ├── watcher.ts            # File watcher (polls every 5s)
│   │   ├── importer.ts           # Parse Holly CSV exports
│   │   ├── auto-eval.ts          # Auto-trigger evals for alerts
│   │   └── ...                   # Predictor, backtester, optimizer
│   ├── collab/                   # AI-to-AI collaboration channel
│   ├── ws/                       # WebSocket server (real-time events)
│   ├── tradersync/               # TraderSync CSV import
│   ├── divoom/                   # Pixel art display integration
│   └── __tests__/                # Co-located unit tests
├── frontend/                     # Next.js 14 admin dashboard
│   ├── src/app/                  # Pages: dashboard, evals, journal, etc.
│   └── package.json              # React 19, TanStack, Recharts, Zustand, shadcn/ui
├── test/ & tests/                # Integration & additional test suites
├── scripts/                      # Utility scripts (api-audit.mjs)
├── data/                         # Runtime data (SQLite DB, logs, weights)
├── analytics/                    # Python scripts for edge analysis
├── docs/                         # Additional documentation
├── .github/workflows/            # CI/CD (agent-auto-merge, api-audit)
├── package.json                  # Root config & scripts
├── tsconfig.json                 # TypeScript strict config (ES2022, Node16)
└── vitest.config.ts              # Test runner config
```

## BUILD & DEVELOPMENT COMMANDS

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TypeScript to `build/` |
| `npm start` | Run server (MCP + REST, both modes) |
| `npm run start:mcp` | MCP server only (stdio transport) |
| `npm run start:rest` | REST API only |
| `npm run dev` | Concurrent: API (port 3000) + Next.js UI (port 3001) |
| `npm run dev:api` | API server only |
| `npm run dev:ui` | Frontend dev server only (port 3001) |
| `npm run build:frontend` | Build Next.js static export |
| `npm run build:all` | Build backend + frontend |
| `npm run start:prod` | Build all + start production |
| `npm test` | Run Vitest (1079+ tests) |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Coverage report (V8 provider) |
| `npm run start:paper` | IBKR paper trading (port 7497) |
| `npm run start:live` | IBKR live trading (port 7496) |
| `npm run audit:api` | Run REST endpoint audit script |

**Build before running:** The server runs from `build/`. Always `npm run build` after source changes.

## TESTING

- **Framework:** Vitest with globals enabled, Node environment
- **Test locations:** `src/**/*.test.ts`, `test/**/*.test.ts`, `tests/**/*.test.ts`
- **Conventions:** Co-locate unit tests with source files. Integration tests in `test/`.
- **Helpers:** `test/helpers.ts` — mock IBKR client, Yahoo responses, in-memory SQLite
- **Coverage:** V8 provider, excludes `node_modules/`, `build/`, `frontend/`, test files
- **CI gate:** Type check (`tsc --noEmit`) + full test suite must pass for agent PR auto-merge

Run tests before committing:
```bash
npm run build && npm test
```

## TYPESCRIPT CONVENTIONS

- **Strict mode** enabled — no implicit any, strict null checks
- **Module system:** ES modules (`"type": "module"` in package.json, `"module": "Node16"` in tsconfig)
- **Import extensions:** Use `.js` extensions in imports (Node16 module resolution requires this)
- **Target:** ES2022
- **Output:** `build/` directory with declarations, declaration maps, and source maps
- **Validation:** Zod schemas for all user-facing inputs (REST endpoints, MCP tool params)
- **Tests excluded** from compilation (`**/*.test.ts`, `**/__tests__/**`)

## KEY ARCHITECTURE PATTERNS

### Smart Fallback
Market data routes try IBKR first, fall through to Yahoo Finance on failure:
```typescript
if (isConnected()) {
  try { return await getIBKRQuote(symbol); } catch { /* fall through */ }
}
return await getQuote(symbol); // Yahoo fallback
```

### Parallel Model Evaluation
Eval engine runs 3 models concurrently; one failure doesn't block others:
```typescript
const results = await Promise.allSettled([claude, gpt4o, gemini]);
```

### Graceful Degradation
Server starts even if IBKR is unavailable. Yahoo-based features remain functional. IBKR reconnects in background.

### Deterministic Client ID
MCP (offset 0), REST (offset 1), and combined (offset 2) modes use different IBKR clientIds to avoid collisions.

### Structured Logging
Pino child loggers tagged by subsystem (`orders`, `ibkr`, `rest`, `collab`, `risk`, `database`). Dual output: stderr (human-readable) + file (JSON, daily rotation, 30-day retention).

### Rate Limiting
REST API rate-limited by API key (not IP, safe for Cloudflare Tunnel):
- Global: 100 req/min
- Orders: 10/min
- Eval: 10/min
- Collab: 30/min

### Correlation IDs
Orders, executions, and journal entries linked via `correlation_id` (UUID) for full trade lifecycle tracking.

## ENVIRONMENT CONFIGURATION

Copy `.env.example` to `.env`. Key variables:

| Variable | Default | Notes |
|----------|---------|-------|
| `IBKR_HOST` | 127.0.0.1 | TWS/Gateway IP |
| `IBKR_PORT` | 7497 | Paper=7497, Live=7496 |
| `IBKR_CLIENT_ID` | 0 | Base client ID |
| `REST_PORT` | 3000 | HTTP server port |
| `ANTHROPIC_API_KEY` | — | Required for eval engine |
| `OPENAI_API_KEY` | — | Required for eval engine |
| `GOOGLE_AI_API_KEY` | — | Required for eval engine |
| `DIVOOM_ENABLED` | false | Pixel display integration |
| `HOLLY_WATCH_PATH` | — | Holly AI CSV watch directory |

Ensemble weights loaded from `data/weights.json` with hot-reload (5s file watch).

## DATABASE

- **Engine:** SQLite via better-sqlite3, WAL mode
- **Location:** `data/bridge.db`
- **Key tables:** `trade_journal`, `orders`, `executions`, `positions_snapshots`, `account_snapshots`, `collab_messages`, `evaluations`, `eval_reasoning`, `risk_config`, `weight_history`
- **Schema:** Defined in `src/db/schema.ts` — add new tables there with CREATE TABLE + indexes
- **CRUD:** Add data access functions in `src/db/database.ts`
- **Complex queries:** `src/db/read-models.ts` for aggregate analytics

## CI/CD

### Agent Auto-Merge (`.github/workflows/agent-auto-merge.yml`)
PRs from `copilot/*` or `codex/*` branches targeting `main`:
1. Type check (`tsc --noEmit`)
2. Test suite (`vitest run`)
3. Merge conflict detection
4. Auto squash-merge if all pass; comment errors if blocked

### API Audit (`.github/workflows/api-audit.yml`)
Weekly (Monday 9 AM ET) or manual: runs `scripts/api-audit.mjs` to validate REST endpoints. Creates/updates GitHub issues on failures.

## ADDING NEW FEATURES

**New data provider:** Create `src/providers/myservice.ts`, add routes in `src/rest/routes.ts`, add MCP tools in `src/mcp/server.ts`.

**New eval feature:** Add to `src/eval/features/`, update prompt in `src/eval/models/`, integrate in `src/eval/ensemble/scorer.ts`.

**New database table:** Add schema in `src/db/schema.ts`, CRUD in `src/db/database.ts`, complex queries in `src/db/read-models.ts`.

**New REST endpoint:** Add route handler in `src/rest/routes.ts` with Zod input validation.

**New MCP tool:** Register via `server.tool()` in `src/mcp/server.ts` with Zod schema.

## FRONTEND

- **Framework:** Next.js 14 (static export)
- **Styling:** Tailwind CSS (dark theme), shadcn/ui components
- **State:** React Query (server state), Zustand (client state)
- **Charts:** Recharts
- **Tables:** TanStack Table
- **Pages:** Dashboard, Evals, Model Stats, Weights, Journal, Executions, Orders, Account, Collab, Market, Holly, Session
- **Dev:** `npm run dev:ui` (port 3001), API proxy to port 3000
- **Build:** Static export served by Express from `frontend/out/`

## SECURITY

- Optional API key auth (`X-API-Key` header, timing-safe comparison)
- Zod validation on all inputs; symbol regex: `/^[A-Za-z0-9.\-^=%]{1,20}$/`
- Rate limiting per API key
- Non-fatal IBKR errors silently filtered
- Graceful shutdown on SIGINT, SIGTERM, unhandled rejections
