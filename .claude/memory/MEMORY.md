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
- Build: clean, tests: 1,703 passing (98 files)
- Branch: main (Divoom chart branch merged — 8579cc0, readonly MCP — 64bc742)
- Cloud module: WIP (code complete, not deployed)
- Divoom charts: shipped (7 chart renderers, REST endpoint, @napi-rs/canvas + chartjs-node-canvas)
- MCP readonly mode: `--mode mcp-readonly` (38 mutating tools filtered, analytics-only, no IBKR connect)
- Analytics summary tools: edge_summary, exit_recommendation, regime_summary (always registered)
- Launcher scripts: mcp-launch.cmd, mcp-launch-readonly.cmd (portable `%~dp0` paths)
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
- 8,224 trades, 6,099 with bar data (74.2% coverage, 5-year Polygon lookback)
- 9 Numba-compiled exit kernels, 264 param combos × 34 strategies
- Output: `output/optimal_exit_params.json` — ready for Layer 2 MCP consumption
- **Known bug:** direction inference for `direction_int=0` trades produces unrealistic P&L (Bull Trap $1.85B, Count De Monet -$1.37B) — fix before production use
- Polygon API: paid Starter tier, unlimited rate, `MIN_DATE=2021-03-04`

### Benzinga News Integration
- 3 new MCP tools: `get_benzinga_news`, `get_benzinga_article`, `get_benzinga_providers`
- 3 new REST endpoints: `/api/news/benzinga/providers`, `/api/news/benzinga/headlines/:symbol`, `/api/news/benzinga/article/:articleId`
- Auto-detects provider code from IBKR subscription, caches for session
- Smart defaults: 24h lookback, `buildNewsDateRange()` helper

### Feature Plan
- `docs/FEATURE-PLAN.md` — 5 phases, 13 features, 6 agents, ~52h estimated
- P0: Exit Params MCP tool + direction bug fix
- P1: Sentiment scoring (Codex) + auto-apply exit rules
- P2-P4: Unified news, indicator flags, WebSocket streaming, dashboard
