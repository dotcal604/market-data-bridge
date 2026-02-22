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
- `npm test` → Vitest, 86 test files, 1,459 tests, ~10s runtime
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

## Current State (Feb 2026)
- Build: clean, tests: all passing (1,541 tests, 89 files)
- Branch: claude/trading-cloud-architecture-fYwbQ (integration)
- Main branch: main
- Cloud module: WIP (code complete, not deployed)
- Indicator engine: shipped (streaming EMA/RSI/MACD/BB/ATR/VWAP, 3 MCP tools, 2 REST routes, 38 tests)
- Analytics roadmap: docs/ANALYTICS-ROADMAP.md (Tier 1 done, Tier 2-4 planned)
