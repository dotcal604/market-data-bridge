# Market Data Bridge — Shared Memory

> This file is git-tracked and syncs across machines.
> Claude Code reads this on startup to pick up cross-session context.

## Project Overview
Single-process Node.js 22+ TypeScript trading platform: IBKR + Yahoo Finance + 3-model AI ensemble (Claude/GPT-4o/Gemini). MCP server (136 tools) + REST API (81 endpoints) + Next.js 16 dashboard.

## Build & Run
- `setup.bat` — first-time setup (deps, .env, build)
- `start.bat` — double-click launcher (paper trading, port 7497)
- `start-live.bat` — live trading launcher (port 7496, requires YES confirmation)
- `npm run build` (tsc) → `build/` directory. Must build before running.
- `npm test` → Vitest, 92 test files, 1,555 tests, ~11s runtime
- `npm run dev` → API (port 3000) + frontend (port 3001) concurrently
- Frontend is separate: `cd frontend && npm install` required

## Key Architecture Decisions
- Single-process to prevent duplicate EOD flatten orders
- MCP clients are lean (no scheduler/reconciliation)
- WAL mode SQLite, prepared statements at startup
- Quote routing: IBKR real-time → Yahoo fallback (always disclose source)
- `place_advanced_bracket` for bracket orders (never manual sequencing)
- Feature computation is parallel, no side effects, deterministic

## IBKR Connection Resilience (Hardened)
- Heartbeat every 60s with 3-strike escalation (warn → soft reconnect → hard reconnect)
- Exponential backoff: 2s → 4s → 8s → 16s → 30s cap with jitter
- PID-based clientId slotting prevents collisions between MCP/REST/bridge
- Error-specific handling: 1100 (connectivity lost), 504 (not connected), 326 (clientId collision)
- Multi-callback reconnect hooks so all subsystems re-register

## Agent Fleet
14-15 agents coordinated via AGENTS.md. Cost-aware routing: mastery → free → cheap → expensive.

### Agent CLI Tool Capabilities (Tested)
- **Copilot CLI** (`gh copilot -p`): Proven on this repo. Can read files, write files, run shell commands. Good for mechanical pattern fixes (e.g., F18 silent catches — 65 edits in one run). Use for bulk find-replace, adding logging, simple pattern work.
- **Gemini CLI** (`gemini -i`): Use interactive mode (`-i`), NOT `-p`. Non-interactive mode (`-p`) is read-only on Windows — cannot write files or run commands. Even in `-i` mode, verify it has write/shell access before assigning write-heavy tasks. Better than Copilot for type narrowing and multi-file reasoning (larger context window).
- **Gemini CLI known failure**: `-p` mode face-plants on Windows — no write_file, no run_shell_command, spirals trying tool names that don't exist. Always use `-i` for tasks that require file creation or modification.
- Collab channel upgraded: `type` field (info/request/decision/handoff/blocker) + `metadata` (JSON), wired into check_inbox
- GitHub Mission Control: use github.com/copilot/agents panel for multi-task Copilot delegation (assign, steer mid-task, track)
- Copilot agents panel: lightweight overlay on any github.com page, kick off tasks across repos in parallel
- Real-time steering: can interrupt Copilot mid-task via chat or inline comments in Files changed view
- Custom agents (.github/agents/*.agent.md) auto-loaded by Copilot — 5 defined (backend-dev, frontend-dev, ops-engineer, test-writer, docs-writer)
- Agent HQ gap analysis complete: all 5 .agent.md files now have collab protocol, handoffs YAML, agents field, REST tool docs
- copilot-instructions.md updated with collab channel section
- Handoff chains: backend-dev → test-writer → backend-dev (bug loop), backend-dev → docs-writer, ops-engineer → backend-dev/docs-writer

## Multi-Machine Workflow
- Desktop: primary — runs TWS, bridge, has bridge.db
- Laptop: clone repo, git pull for latest code + memory
- Context syncs via `.claude/memory/` (git-tracked)
- For IBKR on laptop: set IBKR_HOST to desktop IP (Tailscale or LAN)
- For trading from laptop: use Parsec to remote into desktop
- NEVER run two bridge instances simultaneously against the same TWS

## Important Env Var
NEVER set IBKR_CLIENT_ID in .env — causes collision for all MCP clients.

## Current State (Mar 2026)
- Build: clean, tests: 1,740 passing (101 files), 10 pre-existing failures (divoom widgets, agent-catalog, runner)
- Branch: main (all feature branches merged)
- Cloud module: WIP (code complete, not deployed)
- Divoom charts: shipped (7 chart renderers, REST endpoint, @napi-rs/canvas + chartjs-node-canvas)
- MCP readonly mode: `--mode mcp-readonly` (38 mutating tools filtered, analytics-only, no IBKR connect)
- Analytics summary tools: edge_summary, exit_recommendation, regime_summary (always registered)
- Indicator engine: shipped (streaming EMA/RSI/MACD/BB/ATR/VWAP, 3 MCP tools, 2 REST routes, 38 tests)
- Analytics roadmap: docs/ANALYTICS-ROADMAP.md (Tier 1 done, Tier 2-4 planned)
- .claude/launch.json: created (api:3000, frontend:3001, dev-paper:3000)
- Agent handshakes: 11/14 verified — Mintlify(14) ✅ auto-deployed on PR #394; Qodo Gen(8), Windsurf(9) pending (IDE-based)
- CI: ci-build.yml needs --legacy-peer-deps on frontend npm install (pre-existing, not from our changes)
- v0 note: clones repo directly from GitHub (not paste-only) — has "Open PR" button, full codebase context
- pnpm-lock.yaml: removed (was causing Next.js Turbopack workspace root confusion)
- frontend/src/lib/utils/colors.ts: import path fixed (was one level short + .js extension)

### Holly Exit Optimizer (analytics/holly_exit/)
- **Complete pipeline:** Scripts 01→07 all ran successfully
- Full pipeline: Python analytics + TypeScript JIT bridge + React frontend
- Python scripts: `analytics/holly_exit/scripts/` (03-11: fetch, load, optimize, suggest, walk-forward)
- Walk-forward validation: 5-fold rolling, 30 robust / 18 overfit strategies (6,078 trades)
- 8,224 trades, 6,099 with bar data (74.2% coverage, 5-year Polygon lookback)
- 9 Numba-compiled exit kernels, 264 param combos × 34 strategies
- TypeScript bridge: `src/holly/suggest-exits.ts` — loads optimizer JSON + WF summary, maps to ExitPolicy
- REST API: 4 agent actions (suggest_exits, optimal_exit_summary, optimal_exit_meta, optimal_exit_reload)
- Frontend: `/holly/exits` page with simulator + leaderboard table + WF validation badges
- Scheduler: `daily_exit_refresh` at 16:30 ET (45min timeout, runs full pipeline)
- Daily orchestrator: `analytics/daily_exit_refresh.py` (fetch → load → optimize → suggest → walk-forward)
- Output files: `analytics/holly_exit/output/` (optimal_exit_params.json, walk_forward_summary.json)
- **Known bug:** direction inference for `direction_int=0` trades produces unrealistic P&L (Bull Trap $1.85B, Count De Monet -$1.37B) — fix before production use
- Polygon API: paid Starter tier, unlimited rate, `MIN_DATE=2021-03-04`
- **Polygon flat files (S3):** daily fully loaded to `daily_bars_flat` DuckDB table
- **Minute flat files:** 1,047 files, 20.78 GB on disk (2022-01-03 → 2026-03-06), NOT in DuckDB (too large, query .csv.gz directly)
- 5-year plan window: currently 2022–2026 accessible, 2003–2021 = 403 Forbidden

### Silver Layer Normalization (Extended)
- `build_silver.py` now produces **238 columns** (up from 224)
- Dual-track: vendor_R (from holly_pnl) vs price_exit_R (from entry/exit math)
- Quality flags: bad_risk_flag, penny_flag, low_price_flag, high_risk_pct_flag, small_cap_flag
- Stratification: price_bucket (7 bins), hold_bucket (5 bins)
- Capture ratios, capital efficiency (RON), vendor-price disagreement flag
- **8 Bronze sources wired in:** etf_bars (SPY), market_daily (breadth), daily_bars_flat (gaps), Polygon indicators, Polygon snapshots, FRED put/call ratio, economic events, earnings calendar
- New dimensions: relative_return_vs_spy, mkt_ad_ratio, mkt_breadth_regime, gap_bucket, gap_direction
- **Polygon indicator features (16 cols):** ind_sma_20/50, ind_ema_9/21, ind_rsi_14, ind_macd_value/signal/histogram, ind_above_sma20/50, ind_sma_golden_cross, ind_ema_bullish, ind_rsi_zone, ind_macd_trend, ind_price_vs_sma20/50_pct
- **Polygon snapshot features (11 cols):** snap_day_vwap, snap_prev_close, snap_change_pct, snap_day_open/high/low/close/volume, snap_prev_volume, snap_price_vs_vwap, snap_price_vs_vwap_pct
- Coverage: indicators 6,359/28,875 (22%, data starts 2021), snapshots accumulating daily
- **CBOE put/call ratio (4 cols):** macro_put_call_equity/total/regime/momentum — 17,911/28,875 (62%, CBOE data 2006-2019)
- **Economic event flags (4 cols):** is_fomc_day, is_nfp_day, is_event_day, event_type — 2,346 trades on event days (8.1%)
- **Earnings proximity (1 col):** is_earnings_day — needs full yfinance fetch for coverage (only 10 symbols cached)
- PBI rewired: `powerbi/data-prep.pq` now reads Silver Parquet (was holly_analytics.xlsx)
- `13_export_analytics.py` deprecated with runtime DeprecationWarning → use build_silver.py

### Sizing Simulation (30_sizing_simulation.py)
- 3 engines: baseline (100 shares), fixed_notional, hybrid_risk_cap
- 36 scenarios, 28,875 trades, 1M+ output rows
- **Key finding**: vendor baseline $57.8M vs price baseline $79K — holly_pnl ≠ entry→exit math
- Best hybrid: $100k/0.75% risk/15% cap → $461K total, $15.30 expectancy
- Live calibration from 17 IBKR fills: cap grid $652/$814/$1,442/$1,508

### Feature Plan
- `docs/FEATURE-PLAN.md` — 5 phases, 13 features, 6 agents, ~52h estimated
- P0: Exit Params MCP tool + direction bug fix
- P1: Sentiment scoring (Codex) + auto-apply exit rules
- P2-P4: Unified news, indicator flags, WebSocket streaming, dashboard

### Supabase + NocoDB (Planned)
- Architecture sketch: `docs/SUPABASE-NOCODB-SKETCH.md`
- Supabase org: KLFH (ID: mytpjnuenchlloqowkrr), no project created yet
- Schema: tasks, task_links (junction w/ entity_type enum), research_runs, strategy_notes, agent_sessions
- NocoDB: spreadsheet UI + MCP server for agent CRUD
- Free tier sufficient for task management scale
- Will seed tasks from FEATURE-PLAN.md, backfill research_runs from existing experiments
