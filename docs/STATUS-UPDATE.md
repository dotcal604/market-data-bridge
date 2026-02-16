# Market Data Bridge — Project Status Update

**Date:** 2026-02-16
**Version:** 3.0.0
**Author:** dotcal604

---

## Executive Summary

Market Data Bridge is a TypeScript server that connects Interactive Brokers (TWS/Gateway) to AI assistants (Claude, ChatGPT, and others) via MCP and REST protocols. It's been developed over ~100 commits across 3 days in an intensive AI-assisted build sprint. The system is **functional in daily use** with 77 MCP tools, 71 REST endpoints, a 3-model AI eval engine, and a Next.js dashboard — but has hardening work ahead before it's production-grade.

**Bottom line:** Core functionality works. Risk controls exist but have a timezone bug in tests. No Docker, no CI test runner, several hardcoded values need extraction. The eval engine and dashboard are early-stage. Order execution path is the highest-priority area for hardening.

---

## Current State

### What's Built

| Module | LOC | Status | Notes |
|--------|-----|--------|-------|
| **IBKR Integration** (`src/ibkr/`) | 3,814 | Working | Orders, brackets, OCA, trailing stops, account data, market data |
| **REST API** (`src/rest/`) | 4,472 | Working | 71 endpoints, rate limiting, API key auth, OpenAPI spec |
| **Eval Engine** (`src/eval/`) | 2,689 | Working | 3-model ensemble (Claude/GPT-4o/Gemini), 13 features, drift detection |
| **MCP Server** (`src/mcp/`) | 1,988 | Working | 77 tools, stdio transport, MCP-over-HTTP sessions |
| **Database** (`src/db/`) | 1,578 | Working | SQLite via better-sqlite3, order/execution persistence, reconciliation |
| **Frontend** (Next.js) | ~89 files | Early | 11 pages, Recharts, shadcn/ui, Zustand state |
| **Data Providers** (`src/providers/`) | 696 | Working | Yahoo Finance + IBKR smart routing |
| **TraderSync** (`src/tradersync/`) | 211 | Working | CSV import, stats aggregation |
| **Collab Channel** (`src/collab/`) | 144 | Working | AI-to-AI messaging |

**Total production code:** ~16,000 lines TypeScript
**Total test code:** ~5,300 lines across 22 test files

### Test Results (as of 2026-02-16)

```
Test Files:  1 failed | 21 passed (22)
Tests:      22 failed | 281 passed (303)
```

- **21/22 test files pass** (281 tests green)
- **1 failing file:** `risk-gate.test.ts` — all 22 failures are timezone-related
  - Tests hardcode UTC timestamps from January 2025
  - Risk gate uses `new Date()` → Eastern Time conversion
  - Running tests on 2026-02-16 (a Sunday / outside market hours) causes "outside trading hours" rejections
  - **Root cause:** Tests don't properly mock the full date context needed for market-hours checks
  - **Fix:** Straightforward — tests need `vi.setSystemTime()` to mock dates that fall within market hours for the "should allow" cases

### Architecture

```
┌──────────────────────────────────────────────────┐
│                   Clients                        │
│  Claude Desktop/Code ──── ChatGPT ──── Browser   │
│        (MCP stdio)      (REST/OpenAPI)  (Next.js)│
└──────┬───────────────────┬──────────────┬────────┘
       │                   │              │
┌──────▼──────┐     ┌──────▼──────┐  ┌────▼─────┐
│  MCP Server │     │  REST API   │  │ Frontend │
│  77 tools   │     │  71 routes  │  │ Next.js  │
│  (stdio)    │     │  (Express)  │  │ (port    │
│             │     │  (port 3000)│  │  3001)   │
└──────┬──────┘     └──────┬──────┘  └──────────┘
       │                   │
       └─────────┬─────────┘
                 │
    ┌────────────▼────────────┐
    │      Core Services      │
    │  ┌─────────────────┐    │
    │  │ IBKR Connection  │    │
    │  │ (auto-reconnect) │    │
    │  └────────┬────────┘    │
    │  ┌────────▼────────┐    │
    │  │ Risk Gate        │    │
    │  │ (session limits) │    │
    │  └─────────────────┘    │
    │  ┌─────────────────┐    │
    │  │ Eval Engine      │    │
    │  │ (3-model ensemble│    │
    │  │  + drift detect) │    │
    │  └─────────────────┘    │
    │  ┌─────────────────┐    │
    │  │ SQLite DB        │    │
    │  │ (orders, evals,  │    │
    │  │  journal, collab)│    │
    │  └─────────────────┘    │
    └─────────────────────────┘
                 │
    ┌────────────▼────────────┐
    │   External Services     │
    │  IBKR TWS/Gateway       │
    │  Yahoo Finance          │
    │  Claude / GPT-4o /      │
    │  Gemini APIs            │
    └─────────────────────────┘
```

---

## Key Metrics

| Metric | Value |
|--------|-------|
| Version | 3.0.0 |
| Total Commits | 100 |
| Development Period | 3 days (Feb 13-16, 2026) |
| Production LOC | ~16,000 |
| Test LOC | ~5,300 |
| Test/Production Ratio | 33% |
| Test Pass Rate | 281/303 (92.7%) |
| MCP Tools | 77 |
| REST Endpoints | 71 |
| Frontend Pages | 11 |
| Dependencies | 14 runtime, 9 dev |
| Node.js Requirement | 18+ |
| PRs Merged | 152 |

---

## What Works Well

1. **Dual-protocol architecture** — Same backend serves both MCP (Claude) and REST (ChatGPT/browser) with consistent behavior
2. **IBKR connection resilience** — Auto-reconnect with clientId collision recovery, graceful degradation to Yahoo data when TWS is down
3. **Risk gate** — Multi-layer protection: order size limits, notional caps, rate limiting, daily loss limits, consecutive loss cooldown, late-day lockout
4. **Advanced bracket orders** — OCA groups, trailing stops, parent-child linking, DB persistence before submission
5. **Eval engine** — 3-model ensemble with 13 quantitative features, drift detection, weight simulation, and outcome tracking
6. **Test coverage on critical paths** — Orders (786 lines of tests), all 13 eval features individually tested, risk gate logic tested

---

## Known Issues & Technical Debt

### High Priority

| Issue | Location | Impact |
|-------|----------|--------|
| **Risk gate timezone bug** | `src/ibkr/__tests__/risk-gate.test.ts` | 22 tests failing — test dates don't account for current date/timezone properly |
| **API key comparison is not timing-safe** | `src/rest/server.ts:26` | `===` comparison vulnerable to timing attacks; should use `crypto.timingSafeEqual` |
| **No CI test runner** | Missing | Tests only run locally; no PR gate on test failures |
| **DB writes before IBKR submission** | `src/ibkr/orders.ts:921-928` | Order recorded in DB, then submitted to IBKR — if IBKR rejects, orphaned DB records remain |

### Medium Priority

| Issue | Location | Impact |
|-------|----------|--------|
| **6 hardcoded timeouts** | `src/ibkr/orders.ts` (lines 50, 141, 236, 552, 723, 936) | 10-15s timeouts with no env var override — can't tune for network conditions |
| **Hardcoded eval config values** | `src/eval/config.ts:14-20` | Trading window, penalty coefficients, loss limits not configurable via env |
| **Hardcoded market hours in risk gate** | `src/ibkr/risk-gate.ts:20-23` | 9:00-16:00 not env-configurable |
| **No Docker setup** | Missing | No containerized deployment option |
| **OCA type hardcoded to 1** | `src/ibkr/orders.ts:910-911` | Advanced bracket always uses "cancel with block" — can't use reduce modes |
| **`as any` type casts on IBKR types** | `src/ibkr/orders.ts` (throughout) | Working around `@stoqey/ib` type gaps — fragile if library updates |
| **Rate limits hardcoded** | `src/rest/server.ts:40-78` | 100/10/30/10 per-category limits, no env override |

### Low Priority

| Issue | Location | Impact |
|-------|----------|--------|
| LLM API keys default to empty string with no validation | `src/eval/config.ts:2-4` | Silent failures if keys not set |
| Session TTL hardcoded to 30 min | `src/rest/server.ts:86` | Not configurable |
| `maxClientIdRetries` hardcoded to 5 | `src/config.ts:11` | Should be env var for debugging |
| Missing negative tests for bracket partial failures | `src/ibkr/__tests__/orders.test.ts` | No test for parent placed but child rejected |

---

## Roadmap

### Phase 1: Stabilize (Next 1-2 weeks)

- [ ] **Fix risk-gate test timezone bug** — Make tests pass regardless of when they run
- [ ] **Add timing-safe API key comparison** — `crypto.timingSafeEqual`
- [ ] **Extract hardcoded timeouts to config** — All 6 order timeouts + eval config values
- [ ] **Add GitHub Actions CI** — `npm test` on PR, block merge on failure
- [ ] **Add Dockerfile** — Containerized deployment for consistent environments
- [ ] **Wire OCA type through to params** — Allow `ocaType: 2 | 3` in advanced brackets

### Phase 2: Harden (Weeks 3-4)

- [ ] **Add negative/edge-case tests for order execution** — Partial fills, IBKR rejection after DB write, connection drop mid-bracket
- [ ] **DB write rollback on IBKR failure** — Transaction-based approach for bracket order DB persistence
- [ ] **Rate limit configuration via env vars** — All 4 rate limiter categories
- [ ] **LLM API key validation at startup** — Fail fast if eval engine is enabled but keys are missing
- [ ] **Integration test suite with mock IBKR** — Full order lifecycle without live TWS

### Phase 3: Polish (Weeks 5-8)

- [ ] **Frontend completion** — Currently 11 pages, needs order entry forms, real-time updates, and mobile responsiveness
- [ ] **Eval engine backtesting** — Historical evaluation replay against recorded outcomes
- [ ] **Monitoring & alerts** — Health check endpoint, structured logging aggregation
- [ ] **Documentation** — API reference generated from OpenAPI, architecture decision records
- [ ] **Performance profiling** — SQLite query performance under load, WebSocket vs polling for frontend

---

## Blockers

| Blocker | Impact | Mitigation |
|---------|--------|------------|
| **No CI pipeline** | Tests can regress silently; PRs merge without validation | Add GitHub Actions workflow running `npm test` |
| **Risk gate test failures** | Can't trust test suite as a gate; 22 false failures mask real issues | Fix timezone handling in tests |
| **IBKR requires live TWS for integration testing** | Can't fully test order execution in CI | Build mock IBKR adapter for integration tests |
| **Solo developer** | Bus factor = 1; all context in one person's head | This document + CLAUDE.md + AI-assisted workflows |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ / TypeScript 5.7 |
| AI Protocols | MCP SDK 1.12, REST/OpenAPI |
| Broker | Interactive Brokers via @stoqey/ib 1.5 |
| Market Data | Yahoo Finance 2 (3.13) |
| AI Models | Claude (Anthropic SDK 0.74), GPT-4o (OpenAI SDK 6.21), Gemini (Google GenAI 1.0) |
| Database | SQLite via better-sqlite3 |
| HTTP | Express 4.21, express-rate-limit |
| Validation | Zod 3.25 |
| Logging | Pino 10.3 |
| Frontend | Next.js 16.1, React 19.2, Tailwind 4, shadcn/ui, Recharts, Zustand |
| Testing | Vitest 4.0 |
