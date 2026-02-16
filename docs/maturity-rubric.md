# System Maturity Rubric

> Persistent, owned scoring criteria. Models challenge the scores — they don't generate them.
> Updated weekly as part of the audit → assess → update loop.

## Scoring

Each dimension scored 1-5:
- **1** = Not started
- **2** = Prototype / partial
- **3** = Functional, untested in production
- **4** = Production-ready, manually verified
- **5** = Battle-tested, automated verification

---

## Dimensions

### 1. IBKR API Coverage

_Target spec: `docs/ibkr-coverage.md` (Issue #163)_

| Sub-area | Score | Evidence |
|----------|-------|----------|
| Connection + reconnect | 3 | Auto-retry with clientId increment. No stress test under disconnect-during-order. |
| Account & portfolio | 4 | Full CRUD, tested, used daily. |
| Order placement (single) | 4 | Market, limit, stop. Integration tests exist. |
| Bracket / OCA orders | 3 | Works but ocaType hardcoded, sequential ID assumption (#162). |
| Market data (snapshot) | 4 | Yahoo + IBKR snapshots working. |
| Market data (streaming) | 1 | Not started (#105). Polling only. |
| Historical data | 4 | Bars, ticks, fundamentals all wired. |
| News | 4 | Providers, articles, bulletins. |
| Scanner | 2 | Screener page exists but uses Yahoo, not TWS scanner. |
| Contract lookups | 4 | Symbol search, option chains, contract details. |

**Aggregate: 3.3 / 5**

### 2. Eval Engine Integrity

| Sub-area | Score | Evidence |
|----------|-------|----------|
| 3-model ensemble scoring | 4 | Claude, GPT, Gemini. Weighted. Tested. |
| Confidence calibration | 4 | Brier scores, calibration curves, decile bucketing. |
| Drift detection | 4 | Rolling accuracy, regime shift alerts, scheduler-automated. |
| Weight management | 4 | Recalibration script, simulation endpoint, history tracking. |
| Structured reasoning | 4 | Per-model key_drivers, risk_factors as JSON. |
| Outcome recording | 3 | Manual form entry. No automated fill matching. |

**Aggregate: 3.8 / 5**

### 3. Risk Management

| Sub-area | Score | Evidence |
|----------|-------|----------|
| Position sizing | 4 | Half-Kelly, config from DB, regime scaling. |
| Pre-trade risk gate | 3 | checkRisk() works but 22 tests failing (#161). |
| Session guardrails | 3 | Daily loss, consecutive loss, cooldown. Tested but timezone bug. |
| Rate limiting | 4 | Orders-per-minute throttle, API rate limits. |
| Penny stock / notional limits | 4 | Configurable via env vars. |

**Aggregate: 3.6 / 5**

### 4. Runtime Truth (GPT-5.2's addition)

| Sub-area | Score | Evidence |
|----------|-------|----------|
| Structured logging | 4 | Pino with service/subsystem tags. |
| Telemetry / metrics | 1 | No Prometheus, no Sentry, no metrics export. |
| Replay capability | 1 | No order replay or simulation harness. |
| Incident history | 1 | No incident log beyond git commits. |
| Reconnect resilience | 2 | Auto-reconnect exists, no test for mid-order disconnect. |

**Aggregate: 1.8 / 5**

### 5. Deployment & Operations

| Sub-area | Score | Evidence |
|----------|-------|----------|
| Production build | 2 | Backend builds, frontend needs `npm run dev` separately (#81). |
| CI/CD | 1 | No GitHub Actions, no automated test runs. |
| Environment config | 3 | Env vars for most things, some hardcoded (#162). |
| Documentation | 3 | API reference, runbook, system card exist. CLAUDE.md comprehensive. |
| Monitoring / alerting | 1 | Drift alerts in logs only. No external monitoring. |

**Aggregate: 2.0 / 5**

---

## Overall Maturity: 2.9 / 5

| Dimension | Score |
|-----------|-------|
| IBKR Coverage | 3.3 |
| Eval Engine | 3.8 |
| Risk Management | 3.6 |
| Runtime Truth | 1.8 |
| Deployment & Ops | 2.0 |
| **Average** | **2.9** |

---

## What This Tells Us

The system is **strong on logic, weak on operations**. The eval engine and risk management are approaching production quality. But there's no telemetry, no CI, no deployment pipeline, and no way to know if the system is misbehaving in production without watching the logs manually.

## Priority Actions (from rubric gaps)

1. **Runtime truth** is the biggest gap. Even basic Sentry error tracking would move this from 1.8 → 3.0.
2. **CI** — even a single GitHub Action running `vitest run` on push would catch regressions.
3. **Production build** (#81) — single command to build + serve everything.
4. **Streaming market data** (#105) — the remaining major IBKR capability gap.

---

## Audit Cadence

Weekly (or after major feature merge):
1. Run `npx vitest run` — update test counts
2. Review open issues — update scores
3. Challenge scores with a different model ("Here's my rubric. Where am I fooling myself?")
4. Update this file
