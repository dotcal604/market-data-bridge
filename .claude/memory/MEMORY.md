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
14-15 agents coordinated via ORCHESTRATION.md + AGENTS.md. Cost-aware routing: mastery → free → cheap → expensive.

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
- Build: clean, tests: all passing (1,693 tests, 98 files)
- Branch: divoom/widget-engine (active work), main is base
- Cloud module: WIP (code complete, not deployed)
- Divoom charts: shipped (7 chart renderers, REST endpoint, @napi-rs/canvas + chartjs-node-canvas)
- MCP readonly mode: `--mode mcp-readonly` (38 mutating tools filtered, analytics-only, no IBKR connect)
- Analytics summary tools: edge_summary, exit_recommendation, regime_summary (always registered)
- Indicator engine: shipped (streaming EMA/RSI/MACD/BB/ATR/VWAP, 3 MCP tools, 2 REST routes, 38 tests)

## Holly Exit Optimizer (NEW — Mar 2026)
- Full pipeline: Python analytics + TypeScript JIT bridge + React frontend
- Python scripts: `analytics/holly_exit/scripts/` (03-11: fetch, load, optimize, suggest, walk-forward)
- Walk-forward validation: 5-fold rolling, 30 robust / 18 overfit strategies (6,078 trades)
- TypeScript bridge: `src/holly/suggest-exits.ts` — loads optimizer JSON + WF summary, maps to ExitPolicy
- REST API: 4 agent actions (suggest_exits, optimal_exit_summary, optimal_exit_meta, optimal_exit_reload)
- Frontend: `/holly/exits` page with simulator + leaderboard table + WF validation badges
- Scheduler: `daily_exit_refresh` at 16:30 ET (45min timeout, runs full pipeline)
- Daily orchestrator: `analytics/daily_exit_refresh.py` (fetch → load → optimize → suggest → walk-forward)
- Output files: `analytics/holly_exit/output/` (optimal_exit_params.json, walk_forward_summary.json)
