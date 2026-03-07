# Agent #2 (Claude Code) Briefing — Copilot Deep Codebase Audit Results

## Context
Copilot (#5) performed an 8-agent deep audit of `main` (commit `48671e5`) on 2026-03-07. This briefing summarizes 30 findings across 4 severity tiers so you can prioritize remediation.

---

## 🔴 CRITICAL — 9 Findings (Execution-Critical + Security)

### Orders / Execution Safety

**F01 — Simple bracket orders missing OCA group**
`src/ibkr/orders_impl/write.ts:181-325`
`placeBracketOrder()` does NOT set `ocaGroup`/`ocaType` on TP and SL child orders. If TP fills, SL remains active → sells shares twice → creates unintended short position. `placeAdvancedBracket()` correctly sets OCA (line 340+). Fix: add OCA group to simple bracket's TP/SL orders.

**F02 — DB insert failure does not block order transmission**
`src/ibkr/orders_impl/write.ts:104-106`
`insertOrder()` failure is caught, logged, but execution CONTINUES to `ib.placeOrder()`. Result: order placed on IBKR but untracked in local DB. Reconciliation will see an "unknown external order." Fix: throw on DB insert failure to prevent untracked orders.

**F03 — Bracket order race condition on order IDs**
`src/ibkr/orders_impl/write.ts:183-185`
`parentId+1` and `parentId+2` assumed available. Concurrent bracket placements could collide. Fix: request 3 sequential IDs from IBKR or serialize bracket placement with a mutex.

**F04 — Flatten bypasses risk gate entirely**
`src/rest/routes.ts:1263-1274`
`flattenAllPositions()` calls `placeOrder()` directly without `checkRisk()`. Also, SELL orders bypass late-day lockout and max notional checks in `risk-gate.ts:258,280`. No audit trail that flatten was authorized.

### Eval Engine

**F05 — Model runner hardcodes model_id to "claude" on failure**
`src/eval/models/runner.ts:46`
When any model fails in `Promise.allSettled()`, the fallback `ModelEvaluation` always sets `model_id: "claude"`. GPT/Gemini failures are attributed to Claude → corrupts drift detection, model calibration, and per-model accuracy tracking. Fix: use the index from `Promise.allSettled` to map to `["claude","gpt4o","gemini"][index]`.

### Security

**F06 — REST_API_KEY defaults to empty string**
`src/config.ts:44`
`apiKey: process.env.REST_API_KEY ?? ""` — if env var is missing, ALL endpoints are unauthenticated. No production guard. Fix: throw on startup in production if `REST_API_KEY` is unset or < 16 chars.

**F07 — No WebSocket message rate limiting**
`src/ws/server.ts:178-224`
After authentication, clients can send unlimited subscribe/message events. DoS vector via message flooding. Fix: per-connection message counter with 100/min limit.

### Type Safety

**F08 — @types/express v5 for Express v4**
**F09 — @types/better-sqlite3 v7 for runtime v12**
`package.json` — Major version mismatches between runtime packages and their type definitions. Type checking gives false confidence. Fix: align `@types/express` to `^4.x` and `@types/better-sqlite3` to version matching v12.

---

## 🟠 HIGH — 10 Findings

**F10 — WS IBKR listener duplication on reconnect** (`src/ws/server.ts:114-141`)
`bindIBKR()` adds `.on()` listeners but never removes them. After N reconnects, events broadcast N times. Fix: `.off()` old listeners before `.on()` new ones.

**F11 — Async poll() in setInterval without .catch()** (`src/import/watcher.ts:127`, `src/holly/watcher.ts:109`)
Async poll callbacks called from `setInterval` without await or `.catch()`. Silent promise rejections. Fix: wrap with `.catch(err => log.error(...))`.

**F12 — CORS allow-all** (`src/rest/server.ts:65`)
`cors()` with no origin config. Any website can call the API. Fix: whitelist origins via `ALLOWED_ORIGINS` env var.

**F13 — No timeout on feature computation** (`src/eval/features/compute.ts:41`)
`Promise.all()` for Yahoo data has no timeout wrapper. If Yahoo hangs, entire evaluation hangs indefinitely. Fix: wrap with `withTimeout(Promise.all([...]), 8000)`.

**F14 — database.ts god object** (`src/db/database.ts`)
2,139 lines, 106 exports, 45 direct importers. Monolithic coupling. Recommend splitting into domain repos (OrdersRepo, EvalRepo, etc.).

**F15 — No HTTP server graceful close on shutdown** (`src/index.ts:191-202`)
Shutdown closes DB/IBKR/timers but not Express server socket. Pending HTTP requests are force-terminated.

**F16 — No duplicate order detection** (`src/ibkr/orders_impl/write.ts`)
No check for duplicate orders (same symbol/qty in same second). Network retry could place duplicates.

**F17 — Monotonic nextReqId never resets** (`src/ibkr/connection.ts`)
Request ID counter only increments. Potential overflow in long-running processes. Fix: reset on reconnect or use random IDs.

**F18 — 55+ catch blocks with no log.error()** (`src/rest/routes.ts`, `src/eval/routes.ts`)
Production errors silently returned as HTTP 500 but never logged server-side. Zero observability.

**F19 — 100+ `as any` type assertions** (`src/rest/routes.ts`, `src/db/database.ts`, `src/eval/routes.ts`, `src/db/reconcile.ts`)
Defeats TypeScript strict mode.

---

## 🟡 MEDIUM — 11 Findings

**F20** — Signal handlers can stack (double-shutdown) — `src/index.ts:204`
**F21** — Guardrails computed but not enforced at routing layer — `src/eval/routes.ts:140`
**F22** — Only 1/139 frontend components use React.memo — `frontend/src/`
**F23** — 3+ hooks polling every 5s without batching — `frontend/src/lib/hooks/`
**F24** — Frontend types manually duplicated from backend (615 lines) — `frontend/src/lib/api/types.ts`
**F25** — Holly watcher file truncation race condition — `src/holly/watcher.ts:40-47`
**F26** — Collab store dual-write can diverge (memory vs DB) — `src/collab/store.ts`
**F27** — Timezone handling inconsistent (ET vs UTC, no centralized utility) — multiple files
**F28** — SQL injection surface in `addColumnIfMissing` (string interpolation for DDL) — `src/db/database.ts:449`
**F29** — MCP (153 tools) vs REST agent (68 actions) parity gap — no systematic check
**F30** — Accessibility gaps (missing ARIA labels, no keyboard nav on tables) — `frontend/src/components/`

---

## ✅ Confirmed Strengths

- Zero circular imports — clean acyclic dependency graph
- Timing-safe API key comparison (REST + WebSocket)
- Per-API-key rate limiting (Cloudflare-tunnel-aware)
- Symbol validation regex on all endpoints
- Analytics script whitelist (prevents command injection)
- No hardcoded credentials in source
- Zod validation on ~70% of endpoints
- Comprehensive graceful shutdown (timers, watchers, DB, IBKR)
- 153 MCP tools, robust ops monitoring (SLA tracking, availability, incident dispatch)
- 3-layer risk gate (defaults → env → DB, clamped to safe ranges)
- Comprehensive reconciliation on startup (bracket audit, orphan detection)
- Exit plan module is data-only (no automatic order placement — safe)

---

## Recommended Remediation Order

### Sprint 1 — Execution-Critical (F01–F05)
1. **F01**: Add OCA to simple bracket orders (or deprecate `placeBracketOrder` in favor of `placeAdvancedBracket`)
2. **F02**: Make DB insert failure throw (block order transmission if untrackable)
3. **F05**: Fix model_id mapping in runner.ts using `Promise.allSettled` index
4. **F03**: Serialize bracket placement with mutex or request 3 IDs
5. **F04**: Document flatten risk gate bypass as intentional (emergency) or add audit logging

### Sprint 2 — Security (F06–F09, F12)
6. **F06**: Require REST_API_KEY in production (throw on startup if missing)
7. **F07**: Add WebSocket message rate limiting
8. **F08/F09**: Fix @types version mismatches
9. **F12**: Configure CORS origin whitelist

### Sprint 3 — Resilience (F10, F11, F13, F15, F18)
10. **F10**: Fix WS listener leak on reconnect
11. **F11**: Add .catch() to poll callbacks
12. **F13**: Add timeout to feature computation
13. **F15**: Add HTTP server graceful close
14. **F18**: Add log.error() to all catch blocks

### Backlog — Architecture & Frontend
15. **F14**: Split database.ts into domain repos
16. **F19**: Replace `as any` with proper types
17. **F22–F24**: Frontend performance and type sharing
