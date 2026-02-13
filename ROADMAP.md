# Market Data Bridge — Roadmap

> Populated via codebase scanning, competitive research (Bloomberg/TradingView/W&B/MLflow), usage-driven gap analysis, and AI synthesis. See `ORCHESTRATION.md` for agent delegation workflow.

## Current State

- **Backend**: 41 REST endpoints, 34 MCP tools, 10 SQLite tables, 3-model eval engine
- **Frontend**: 5 pages (dashboard, evals, eval detail, weights, weights demo) — **~15% of backend exposed**
- **Tests**: Zero test files
- **Agent PRs merged**: #11 (score scatter), #12 (weight sliders), #13 (time-of-day), #23 (feature radar)
- **IBKR API gap**: @stoqey/ib targets TWS API 10.32; current is 10.42. Backwards compatible — no action needed until library updates.

## Priority Framework

- **P0**: Testing foundation (blocks quality for everything else)
- **P1**: Trading workflow completeness (evaluate → trade → record → analyze)
- **P2**: Research tools, analytics, UX polish
- **P3**: Offline analytics, production deployment

---

## Phase 0: Foundation (P0 — blocking)

Testing infrastructure. Without this, every subsequent phase ships untested code.

| Task | Agent | Status |
|------|-------|--------|
| Vitest + in-memory SQLite setup (vitest.config.ts, test/setup.ts, test/helpers.ts) | Copilot | TODO |
| Ensemble scorer unit tests (Issue #1) | Copilot | Open |
| Feature engine unit tests (all 14 modules in src/eval/features/) | Copilot | TODO |
| Risk gate unit tests (src/ibkr/risk-gate.ts) | Copilot | TODO |

---

## Phase 1: Core Dashboard (COMPLETE)

- [x] Backend: `GET /api/eval/:id` endpoint
- [x] Next.js 14 scaffolding (App Router, shadcn/ui, Tailwind v4, TanStack, proxy config)
- [x] Lib layer: typed API client, React Query hooks, formatters, color utilities
- [x] Layout: sidebar nav, top bar with backend connection status
- [x] Dashboard home (`/`) — stats cards + recent evals
- [x] Eval history (`/evals`) — sortable TanStack Table
- [x] Eval detail (`/evals/[id]`) — 3-model side-by-side, ensemble summary, guardrails, features, outcome
- [x] Weights page (`/weights`) — current ensemble weights display
- [x] Dev workflow: `npm run dev` starts backend + frontend via concurrently

---

## Phase 2: Complete Eval UI (P1)

Close the eval loop — trigger evaluations and record outcomes from the browser.

### Agent-delegated components (from Phase 1 overflow)

| Issue | Component | Agent | PR | Status |
|-------|-----------|-------|----|--------|
| #6 | Score scatter chart | Copilot | #11 | **Merged** |
| #7 | Feature radar chart | Codex | #23 | **Merged** |
| #8 | Time-of-day bar chart | Copilot | #13 | **Merged** |
| #9 | Weight sliders | Copilot | #12 | **Merged** |
| #10 | CSV/JSON export utility | Codex | — | Re-submit |

### New work

| Task | Agent | Priority |
|------|-------|----------|
| **Evaluation trigger form** — symbol autocomplete, direction picker, entry/stop prices, feature preview before submit, POST /api/eval/evaluate | Copilot | P1 |
| **Outcome recording form** — trade_taken toggle, entry/exit prices, auto-calc R-multiple, exit reason dropdown, POST /api/eval/outcome. Embedded in eval detail page | Copilot | P1 |
| **Eval history filters** — symbol search, date range, score range, should_trade toggle. Zustand store for filter state, URL query param sync | Copilot | P1 |
| **Model performance stats page** — per-model accuracy bars, compliance rates, avg confidence, Brier score (if available). GET /api/eval/stats | Copilot | P1 |

### Backend additions (Claude Code)

- [ ] `GET /api/eval/outcomes` — evals joined with outcomes (for scatter plots)
- [ ] `POST /api/eval/weights/simulate` — re-score evals with custom weights
- [ ] `/analytics` page wiring — mount scatter, time-of-day, feature radar into layout
- [ ] `/weights` upgrade — wire sliders to simulate endpoint + "what if" preview

---

## Phase 3: Trading Workflow (P1)

Expose IBKR account data and order management. All backend endpoints exist — this is pure frontend work.

| Task | Agent | Endpoints used |
|------|-------|----------------|
| **Account summary + P&L page** — net liquidation, cash, buying power, daily P&L cards. IBKR connection status indicator | Copilot | GET /api/status, GET /api/account/summary, GET /api/account/pnl |
| **Positions table** — symbol, qty, avg cost, current price, unrealized P&L %, market value. Auto-refresh 10s | Copilot | GET /api/account/positions |
| **Order management** — tabs for open/completed orders, cancel button with confirm dialog, "Cancel All" with double confirm | Copilot | GET /api/account/orders, GET /api/account/orders/completed, DELETE /api/order/:id, DELETE /api/orders/all |
| **Order entry form** — single + bracket modes, symbol autocomplete, real-time quote, risk summary (notional, penny stock check) | Copilot | GET /api/quote/:symbol, POST /api/order, POST /api/order/bracket |
| **Executions log** — exec_id, timestamp, symbol, side, shares, price, commission, realized P&L. Filter by symbol/date | Copilot | GET /api/account/executions |

---

## Phase 4: Journal & Collaboration (P1)

Record trade reasoning before execution, review after. Enable human visibility into AI-to-AI chat.

| Task | Agent | Endpoints used |
|------|-------|----------------|
| **Journal entry form** — symbol, strategy_version, reasoning (textarea), tags. Auto-capture market context: SPY price, VIX, gap%, RVOL, time_of_day | Copilot | POST /api/journal, GET /api/quote/SPY |
| **Journal history + detail** — searchable table, row click → full reasoning + market context + linked orders + outcome update form | Copilot | GET /api/journal, PATCH /api/journal/:id |
| **Collab channel feed** — message feed with author badges (Claude=purple, ChatGPT=green, User=gray), post form, thread view, clear button | Copilot | GET /api/collab/messages, POST /api/collab/message, DELETE /api/collab/messages, GET /api/collab/stats |

---

## Phase 5: Market Data Tools (P2)

Research tools — look up symbols, view charts, run screeners. All endpoints exist.

| Task | Agent | Endpoints used |
|------|-------|----------------|
| **Symbol lookup + quote display** — search autocomplete, bid/ask/last/OHLCV card, company details (sector, PE, 52wk), "Evaluate Trade" button | Copilot | GET /api/search, GET /api/quote/:symbol, GET /api/details/:symbol |
| **Price chart** — candlestick with volume bars, timeframe/interval selectors (1d-YTD) | Copilot | GET /api/history/:symbol |
| **Stock screener** — dropdown for screener type, results table with symbol/price/change/volume/sector | Copilot | GET /api/screener/filters, POST /api/screener/run-with-quotes |
| **News feed + earnings** — news articles for symbol, earnings history chart (actual vs estimate with surprise %) | Jules | GET /api/news/:query, GET /api/earnings/:symbol |

---

## Phase 6: Advanced Analytics (P2)

Data visualization for pattern discovery. Inspired by W&B run comparer and Bloomberg analytics.

| Task | Agent | Notes |
|------|-------|-------|
| **Score distribution histogram** — overlay 3 models in 10-point buckets, filter by date range | Jules | Recharts BarChart with 3 series |
| **Model agreement heatmap** — visualize unanimous/majority/split across evals, tooltip with example IDs | Jules | Custom grid component |
| **Time-of-day performance** — win rate + avg R-multiple by market session bucket | Copilot | PR #13 exists, extend with outcome data |
| **Run Comparer** — select 2-5 evals, scrollable horizontal table comparing all features/scores/outcomes side-by-side | Copilot | W&B-inspired, TanStack Table |
| **Calibration curve** — model predicted confidence vs actual win rate in 5 buckets | Jules | Recharts LineChart |
| **Structured reasoning log** — `eval_reasoning` table capturing per-model key_drivers, risk_factors, uncertainties as JSON. Query via `/api/eval/:id/reasoning`. Enables drift detection + disagreement diagnosis after 50+ outcomes | Claude Code | Minimal "Windsurf" — reasoning harness, not a layer. Add to eval pipeline between features and model calls. ~50 LOC |

---

## Phase 7: UX Polish (P2)

Power user features that compound productivity.

| Task | Agent | Notes |
|------|-------|-------|
| **Command palette (Cmd+K)** — fuzzy search pages, recent symbols, actions (Record Outcome, Place Order, New Journal) | Copilot | shadcn/ui cmdk dialog |
| **Universal CSV export** — reusable `exportToCSV()` utility, add Export button to every table | Copilot | Single utility + button per table |
| **Permalink/shareable state** — encode filter state in URL query params, "Copy Link" button | Copilot | useSearchParams + clipboard API |
| **Keyboard shortcuts** — table navigation (j/k), refresh (r), new eval (n) | Copilot | Global key handler hook |

---

## Phase 8: Python Analytics (P3)

Offline batch analytics for weight recalibration. Runs after 50+ outcomes collected.

| Task | Agent | Notes |
|------|-------|-------|
| **Analytics scaffold** — requirements.txt (pandas, numpy, matplotlib, scikit-learn), utils.py (DB loader), README | Claude Code | Sets up analytics/ directory |
| **Calibration analysis** — Brier score per model, calibration curve PNG, terminal summary | Jules | analytics/calibration.py |
| **Regime analysis** — accuracy by time_of_day, volatility_regime, liquidity_bucket | Jules | analytics/regime.py |
| **Weight update script** — compute performance scores, normalize weights, write data/weights.json | Jules | analytics/update_weights.py |
| **Full report generator** — run all scripts, output markdown report to analytics/reports/ | Jules | analytics/analyze.py |

---

## Backlog (unprioritized)

| Item | Notes |
|------|-------|
| WebSocket server for real-time updates (eval:new, outcome:recorded) | Replaces polling, needs `ws` dep |
| Production build: static export served from Express | Currently dev-only |
| Mobile-responsive layout | Low priority — desktop tool |
| OpenAPI spec update for new eval endpoints | Keep in sync |
| Weight history tracking (INSERT into weight_history table) | Schema exists, no write logic |
| Populate ai_confidence field on orders from eval scores | DB field exists, never used |
| ~~Fix silent catch in ibkr/connection.ts:64~~ | **DONE** (commit 1845305) |
| Expose getRiskLimits() in dashboard (risk gate config viewer) | Exported but unused |
| Options chain viewer | GET /api/options/:symbol exists |
| Financials page | GET /api/financials/:symbol exists |
| **@stoqey/ib upgrade to 10.40+ support** | Order recovery on reconnect, one-message brackets, errorTime, Submitter field. Watch [stoqey/ib](https://github.com/stoqey/ib) for releases. |
| **One-message bracket orders** (TWS API 10.42) | Replace 3-call bracket with single `placeOrder` using `slOrderId`/`ptOrderId` attributes. Depends on @stoqey/ib update. |
| **Min TWS version check** | IBKR dropped <10.30 support (Mar 2025). Add startup warning if connected TWS version is too old. |
| **Decimal tick size handling** (TWS API 10.44, Feb 2026) | `Last_Size`/`Delayed_Last_Size` become Decimal. No action until @stoqey/ib updates. |

---

## API Dependency Monitoring

Automated weekly audit via `.github/workflows/api-audit.yml` + `scripts/api-audit.mjs`.

**What it checks:**
- npm package drift for all tracked deps (`npm outdated`)
- AI model deprecation (hardcoded model names in `src/eval/config.ts`)
- Deprecation calendar with countdown timers

**Schedule:** Every Monday 9:00 AM ET. Creates/updates a GitHub issue labeled `api-audit` when warnings or critical findings detected.

**Manual run:** `node scripts/api-audit.mjs` or trigger via GitHub Actions UI.

**Current deprecation timeline:**

| Deadline | Item | Severity | Action |
|----------|------|----------|--------|
| 2026-03-31 | gemini-2.0-flash shutdown | **Critical (46d)** | Migrate to `gemini-2.5-flash` |
| 2026-06-24 | @google/generative-ai SDK deprecated | Warning | Migrate to `@google/genai` unified SDK |
| 2026-06-30 | yahoo-finance2 v3 breaking changes | Warning | Pin v2.x; v3 is ESM-only + new API |
| TBD | @stoqey/ib 10.42 features | Info | Watch releases for one-message brackets |
| TBD | openai SDK v4→v6 major | Warning | Review breaking changes before upgrading |

---

## Agent Delegation Summary

| Agent | Issues | Strength |
|-------|--------|----------|
| **Copilot** | ~25 | Self-contained UI components, clear props/API specs, multi-file refactors |
| **Jules** | ~8 | Analytical/visualization tasks, Python scripts, single-file utilities |
| **Claude Code** | ~5 | Cross-file wiring, backend routes, architecture, planning |

Decision tree: See `ORCHESTRATION.md`
