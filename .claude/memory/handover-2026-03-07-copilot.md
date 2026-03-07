# Copilot CLI → Claude Code Handover
## Session: 2026-03-07 (Copilot Agent #2)

---

## 1. COMPLETED — Pushed to `main`

### 1.1 Silent Catch Blocks in `src/rest/routes.ts` ✅
**Commit:** `7fe3791` — merged to `main`

Added `log.error({ err: e }, "<METHOD> <path> failed")` to **65 catch blocks** that were returning `res.status(500).json({ error: e.message })` with zero server-side logging. Only 1 of 66 catch blocks (POST /portfolio/stress-test, line 637) had proper logging before this fix.

**Pattern applied:**
```typescript
// BEFORE
} catch (e: any) {
  res.status(500).json({ error: e.message });
}

// AFTER
} catch (e: any) {
  log.error({ err: e }, "GET /quote/:symbol failed");
  res.status(500).json({ error: e.message });
}
```

**Verification:** `tsc --noEmit` clean, `vitest run` — 0 new failures (10 pre-existing in divoom/agent-catalog/runner).

---

## 2. COMPLETED — Uncommitted (staged in working tree)

### 2.1 CORS Wide Open in `src/rest/server.ts` ✅
**Status:** Changed but NOT committed (other unstaged changes in AGENTS.md, ORCHESTRATION.md mixed in)

**What was found:** Line 181 — `app.use(cors())` with no options = `Access-Control-Allow-Origin: *` on every request.

**Fix applied:** Replaced with origin whitelist driven by `ALLOWED_ORIGINS` env var:
```typescript
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3001")
  .split(",")
  .map((o) => o.trim());

app.use(cors({
  origin(requestOrigin, callback) {
    if (!requestOrigin || allowedOrigins.includes(requestOrigin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${requestOrigin} not allowed by CORS`));
    }
  },
  credentials: true,
}));
```

- Default: `http://localhost:3001` (Next.js dev server)
- Non-browser callers (curl, MCP, ChatGPT actions) pass through (`!requestOrigin` guard)
- **Needs:** commit + push, and document `ALLOWED_ORIGINS` in `.env.example`

---

## 3. IDENTIFIED — Bugs Not Yet Fixed

### 3.1 WebSocket Listener Leak on Soft Reconnect
**File:** `src/ws/server.ts`, function `bindIBKR()` (line 114)

**Bug:** On soft reconnect (IBKR disconnect→reconnect without destroying the IBApi instance), the `onReconnect` callback sets `ibkrBound = false` and calls `bindIBKR()` again. Since `getIB()` returns the **same** IBApi singleton after soft reconnect, `.on()` listeners accumulate without `.off()` cleanup.

**Impact:** After N soft reconnects, every IBKR event (openOrder, orderStatus, updatePortfolio, updateAccountValue, execDetails) fires N broadcast calls to WebSocket clients. 5 listeners × N reconnects.

**Hard reconnect is safe** — `destroyIB()` nulls the instance, `getIB()` creates a new one, old listeners are GC'd.

**Fix approach:** Either:
- (a) Call `ib.off()` / `ib.removeAllListeners()` for the 5 events before re-binding, or
- (b) Store listener references and remove them in the `onReconnect` callback before re-adding, or
- (c) Skip re-binding on soft reconnect (only reset `ibkrBound` on hard reconnect when instance is destroyed)

**Events affected:**
| EventName | Channel |
|-----------|---------|
| `openOrder` | `orders` |
| `orderStatus` | `orders` |
| `updatePortfolio` | `positions` |
| `updateAccountValue` | `account` |
| `execDetails` | `executions` |

> Note: `bindStatusListeners()` (line 146) is **safe** — its `statusBound` flag is never reset.

---

## 4. IDENTIFIED — Code Health Issues

### 4.1 `as any` Casts — 178 across 35 files

**Top offenders (production code only):**
| File | Count | Risk |
|------|-------|------|
| `ibkr/orders_impl/write.ts` | 52 | 🔴 Execution-critical |
| `rest/agent.ts` | 11 | 🟡 |
| `db/database.ts` | 8 | 🟡 |
| `ibkr/orders_impl/read.ts` | 6 | 🟡 |
| `mcp/server.ts` | 6 | 🟡 |
| `ibkr/subscriptions.ts` | 5 | 🟡 |
| `ibkr/marketdata.ts` | 5 | 🟡 |

### 4.2 Swallowed Catch Blocks — 23 locations

**High-priority (silent guardrail failures):**
- `eval/guardrails/behavioral.ts:61,80,108` — 3× catches swallow DB errors with `// DB might not be initialized yet`. Guardrails silently skip if DB fails. Should `logger.warn` and return conservative defaults.

**Medium-priority (divoom display — debugging blind spots):**
- `divoom/widgets/portfolio.ts:167,181`
- `divoom/widgets/movers.ts:159`
- `divoom/widgets/news.ts:82`
- `divoom/screens.ts:132,150`

**Intentional/acceptable (14 locations):** IBKR→Yahoo fallbacks, retry loops, platform detection, schema migration, test cleanup.

### 4.3 SQL Interpolation — No injection risks found
All 5 production locations interpolate **column/table names from internal code** (never user input). Values always use `?` or `@name` binding. No action needed.

### 4.4 Large Files (>500 lines) — 20 files

| Lines | File | Split recommendation |
|-------|------|---------------------|
| 3,101 | `mcp/server.ts` | Extract tool handlers into per-domain files |
| 2,360 | `db/database.ts` | Split into 15 domain repo files (see §4.5) |
| 1,913 | `rest/agent.ts` | Extract action handlers by domain |
| 1,785 | `rest/routes.ts` | Extract route groups into sub-routers |
| 1,010 | `eval/routes.ts` | Split eval vs weight vs drift routes |

### 4.5 `db/database.ts` Split Plan

99 exports, 43 importers, 2,360 lines. Recommended split:

```
src/db/
  core.ts             (4 — getDb, closeDb, isDbWritable, generateCorrelationId)
  eval-repo.ts        (26 — evaluations, model outputs, outcomes, links, drift)
  orders-repo.ts      (7 — order CRUD + queries)
  executions-repo.ts  (6 — execution CRUD + correlation lookups)
  inbox-repo.ts       (8 — inbox items)
  risk-repo.ts        (7 — risk config + weight history)
  mcp-repo.ts         (6 — MCP session tracking)
  snapshots-repo.ts   (5 — position + account snapshots)
  signals-repo.ts     (5 — signals)
  holly-repo.ts       (5 — holly alerts)
  tradersync-repo.ts  (5 — TraderSync import/query)
  analytics-repo.ts   (5 — analytics jobs)
  journal-repo.ts     (4 — journal CRUD)
  drift-repo.ts       (3 — drift alerts)
  collab-repo.ts      (3 — collab messages)
  index.ts            (re-exports everything for backward compat)
```

---

## 5. IDENTIFIED — Test Coverage Gaps

**76 of 165 source files have no corresponding test file.**

### 🔴 Critical untested files (money/orders/auth)

| File | Risk |
|------|------|
| `ibkr/account.ts` | Account summary, positions, P&L |
| `ibkr/orders_impl/listeners.ts` | Order fill/status event handling |
| `ibkr/orders_impl/index.ts` | Order module barrel |
| `ibkr/orders_impl/types.ts` | Order type definitions |
| `tradersync/cli.ts` | Trade record imports |

### Priority test backlog

| Priority | Files | Why |
|----------|-------|-----|
| P0 | `ibkr/account.ts`, `ibkr/orders_impl/listeners.ts` | Financial data + order event handling |
| P1 | `eval/models/providers/{claude,gemini,openai}.ts` | Model response Zod validation |
| P1 | `exit-plan/recommend.ts` | Exit recommendations |
| P2 | `ops/webhook.ts` | Alerting pipeline |
| P2 | `import/parsers.ts` | CSV parsing correctness |
| P3 | `holly/suggest-exits.ts` (700 lines) | Exit suggestion engine |

### Untested by subsystem

| Subsystem | Untested/Total |
|-----------|---------------|
| divoom | 32/~35 (low risk — hardware display) |
| eval | 10/~20 (types + 3 model providers) |
| ibkr | 9/~15 (4 critical) |
| import | 5/~7 |
| ops | 4/~5 |
| exit-plan | 3/~4 |
| rest | 3/~8 |
| providers | 2/~4 |
| holly | 2/~8 |

---

## 6. Pre-existing Test Failures (10 — not caused by this session)

These were failing before any changes and remain failing:
- `src/divoom/__tests__/display.test.ts` (1 failure)
- `src/divoom/__tests__/screens.test.ts` (3 failures)
- `src/divoom/widgets/__tests__/engine.test.ts` (4 failures)
- `src/rest/__tests__/agent-catalog.test.ts` (1 failure — likely stale action count)
- `src/eval/models/__tests__/runner.test.ts` (1 failure)

---

## Suggested Next Actions for Claude Code

1. **Fix WS listener leak** (§3.1) — small, high-impact, safety-relevant
2. **Commit CORS fix** (§2.1) — already applied, just needs isolated commit
3. **Add `logger.warn` to behavioral guardrail catches** (§4.2) — 3-line fix, prevents silent guardrail bypass
4. **Write P0 tests** for `ibkr/account.ts` and `ibkr/orders_impl/listeners.ts`
5. **Plan `db/database.ts` split** (§4.5) — biggest maintainability win
