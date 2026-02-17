# Market Data Bridge — Edge Roadmap

> This is an **edge roadmap**, not a product roadmap. Every item is scored against trading edge impact. Features that don't serve edge discovery, measurement, or protection wait.

## Thesis Alignment

Every feature must serve at least one leg of the thesis:

- **A) Structure Edge** — capture market microstructure (spreads, RVOL, float rotation, gap%) that informed humans miss
- **B) Probability Weighting** — 3-model ensemble scoring with calibrated confidence, not point predictions
- **C) Regime Conditioning** — adjust behavior by volatility regime, time-of-day, and liquidity state

Before shipping anything: *"Does this help A, B, or C?"* If not, it waits.

---

## Scoring Framework

Every backlog item is scored on 5 dimensions (1-5 scale):

| Dimension | Question | Scale |
|-----------|----------|-------|
| **Edge Impact (EI)** | Does this increase or protect trading edge? | 0=cosmetic, 1=QoL, 2=observability, 3=risk protection, 4=edge measurement, 5=edge generation |
| **Value** | How much does this improve the system? | 1=nice-to-have → 5=blocks progress |
| **Effort** | How much work? | 1=trivial → 5=multi-week |
| **Delegability** | Can an AI agent safely build this? | 1=must architect yourself → 5=pure CRUD/boilerplate |
| **Dependency** | Does it block other work? | 1=standalone → 5=critical path |

**Composite score**: `(EI × 2 + Value + Dependency) / Effort`

**Delegability warning**: High delegability ≠ "ship fast." AI agents are dangerous at cross-cutting risk logic, capital constraints, state reconciliation, and execution path mods. Low delegability = must be architected by you, not "slower."

---

## Current State

- **Backend**: 68 REST endpoints, 75 MCP tools, 10 SQLite tables, 3-model eval engine
- **Frontend**: 20 pages — Dashboard, Evals, Model Stats, Weights, Journal (+ timeline), Executions, Orders, Account, Collab, Market (symbol lookup, price chart, news/earnings, screener, options chain), Holly (performance, autopsy), Session
- **Tests**: 1079 passing (55 test files) — Vitest + in-memory SQLite
- **SDK versions**: @anthropic-ai/sdk 0.74, openai 6.21, @google/genai 1.0, @stoqey/ib 1.5.3
- **MCP transport**: Streamable HTTP at `/mcp` for ChatGPT connector (session management, 30-min idle TTL)
- **Slash commands**: 16 Claude Code commands in `.claude/commands/` (trading, market data, dev, analytics)
- **Hardening**: Input validation on order routes, symbol regex, crash handlers, safe JSON parsing, TWS version check
- **Analytics**: Python scaffold with 5 scripts (`calibration.py`, `regime.py`, `agreement.py`, `weights.py`, `holly_rules.py`)
- **IBKR coverage**: Market data, news, historical ticks, data wrappers (13 methods), prompt caching, Yahoo recommendations

---

## Edge Experiments (EI ≥ 4)

These directly increase or measure trading edge. **Priority over everything else.**

| Item | EI | Thesis | Status | Agent | Notes |
|------|----|--------|--------|-------|-------|
| **Daily session summary** | 5 | B | **Done** | Claude Code | P&L, win rate, avg R per session. `GET /eval/daily-summary` + `daily_summary` MCP tool. Rolling totals. |
| **Confidence calibration tracking** | 5 | B | **Done** | Codex | #56 — Brier score per model, calibration curve. `analytics/calibration.py` |
| **Structured reasoning log** | 5 | A,B | **Done** | Claude Code | `src/eval/reasoning/extractor.ts` — per-model key_drivers, risk_factors, uncertainties as JSON. Enables drift detection + disagreement diagnosis. |
| **Regime-conditioned accuracy** | 5 | C | **Done** | Codex | #57 — Win rate by volatility_regime × time_of_day × liquidity_bucket. `analytics/regime.py` |
| **Weight recalibration script** | 4 | B | **Done** | Codex | #58 — Compute performance scores from outcomes, normalize weights, write `data/weights.json`. |
| **Drift reconciliation** | 4 | B,C | **Done** | Claude Code | `src/eval/drift.ts` — rolling accuracy, calibration by decile, regime shift detection, REST + MCP tool. Automated alerting via scheduler (30-min checks during market hours, WARN-level log on regime shift). Dead code `drift-detector.ts` removed. |
| **Model agreement analysis** | 4 | B | **Done** | Codex | #59 — Unanimous/majority/split classification. Track: does agreement predict outcome? |
| **Risk gate tuning** | 4 | A | **Done** | Claude Code | risk_config table, half-Kelly auto-tuning, volatility_scalar, REST/MCP endpoints, risk gate enforcement. `calculatePositionSize` now reads tuned config from DB (max_position_pct, volatility_scalar). Regime-based scaling: low=1.0×, normal=0.75×, high=0.5× via `volatilityRegime` param on REST, MCP, and agent routes. |
| **Weight simulation endpoint** | 4 | B | **Done** | Claude Code | `POST /api/eval/weights/simulate` + `simulate_weights` MCP tool. Re-scores historical evals with custom weights. |
| **Outcome auto-link** | 4 | B | Not started | Claude Code | #289 — Auto-link eval → execution → outcome. Closes feedback loop. |

---

## Risk Protection (EI = 3)

Protect capital and prevent silent failures.

| Item | EI | Status | Agent | Notes |
|------|----|--------|-------|-------|
| **Input validation hardening** | 3 | **Done** | Claude Code | Symbol regex, order price validation, limit capping, crash handlers |
| **Risk gate unit tests** | 3 | **Done** | Copilot | PR #36 — 34 tests |
| **Weight history tracking** | 3 | **Done** | Claude Code | `insertWeightHistory()` — records each recalibration. Audit trail. |
| **Min TWS version check** | 3 | **Done** | Claude Code | #282 — Startup warning if connected TWS < 10.30 |
| **One-message bracket orders** | 3 | Blocked | — | Depends on @stoqey/ib update for TWS 10.42. Reduces race conditions. |

---

## Observability (EI = 2)

See what's happening. Required before edge experiments can be measured.

| Item | EI | Status | Agent | Notes |
|------|----|--------|-------|-------|
| **Outcome recording form** | 2 | **Done** | Copilot | PR #32 |
| **Journal entry form** | 2 | **Done** | Copilot | PR #53 — pre-trade reasoning capture |
| **Journal history + detail** | 2 | **Done** | Copilot | PR #54 — searchable, outcome updates |
| **Score scatter chart** | 2 | **Done** | Copilot | PR #11 |
| **Eval outcomes endpoint** | 2 | **Done** | Claude Code | `GET /api/eval/outcomes` + `eval_outcomes` MCP tool. Evals joined with outcomes — unblocks calibration + regime analytics. |
| **Score distribution histogram** | 2 | **Done** | Copilot | PR #129 — 3-model overlay in 10-point buckets |
| **Calibration curve UI** | 2 | **Done** | Copilot | PR #152 — Predicted confidence vs actual win rate |
| **Model agreement heatmap** | 2 | **Done** | Copilot | PR #152 — Pairwise agreement rates, divergence signals |
| **Run Comparer** | 2 | **Done** | Copilot | #121 — Select 2-5 evals, side-by-side comparison |
| **Collab channel feed** | 2 | **Done** | Copilot | PR #55 — human visibility into AI-to-AI chat |
| **Intraday equity curve** | 2 | Not started | Copilot | #292 — Real-time P&L chart on dashboard |
| **Alert webhooks** | 2 | Not started | Codex | #293 — Drift/risk notifications to Discord/Slack |

---

## Infrastructure Stability (EI = 1)

Keep the system running. Don't over-invest here.

| Item | EI | Status | Agent | Notes |
|------|----|--------|-------|-------|
| **Testing foundation** | 1 | **Done** | Copilot | 201 tests, 16 files |
| **SDK migrations** | 1 | **Done** | Mixed | Anthropic 0.74, OpenAI 6, Google genai 1.0 |
| **yahoo-finance2 v3 prep** | 1 | **Done** | Claude Code | Pinned ~3.13.0 |
| **Account summary page** | 1 | **Done** | Copilot | PR #50 |
| **Positions table** | 1 | **Done** | Copilot | PR #49 |
| **Order management page** | 1 | **Done** | Copilot | PR #52 |
| **Executions log** | 1 | **Done** | Copilot | PR #51 |
| **OpenAPI spec update** | 1 | **Done** | Codex | PR #118 — 56+ operations in sync |
| **MCP Streamable HTTP** | 1 | **Done** | Claude Code | `/mcp` endpoint for ChatGPT connector, session management |
| **IBKR data wrappers** | 1 | **Done** | Codex | PR #119 — 13 TWS request/response methods |
| **Historical ticks** | 1 | **Done** | Copilot | PR #114 — reqHistoricalTicks |
| **News stack** | 1 | **Done** | Codex | PR #117 — 4 news methods |
| **Prompt caching** | 1 | **Done** | Codex | PR #116 — Anthropic + Gemini |
| **Yahoo recommendations** | 1 | **Done** | Copilot | PR #115 — analyst consensus |
| WebSocket real-time updates | 1 | Not started | Claude Code | #290 — replaces polling, cross-cutting |
| Production build | 1 | Not started | Claude Code | #291 — static export from Express, cross-cutting |
| Subscription APIs (6 methods) | 1 | Deferred | Claude Code | #105 — needs architecture session (streaming) |

---

## Market Data Tools (EI = 1)

Frontend pages exposing the 68 REST endpoints that currently have no UI.

| Item | EI | Status | Agent | Notes |
|------|----|--------|-------|-------|
| **Symbol lookup + quote** | 1 | **Done** | Copilot | PR #131 — Search, live quote, company info |
| **Price chart** | 1 | **Done** | Copilot | PR #151 — Historical bars, period selector |
| **News + earnings** | 1 | **Done** | Copilot | PR #151 — News feed, earnings history, trending |
| **Stock screener** | 1 | **Done** | Copilot | PR #150 — Pre-built screeners, results table |

---

## Cosmetic (EI = 0) — Ship Only If Free

| Item | Notes |
|------|-------|
| Mobile responsive layout | Desktop tool. Skip. |
| Command palette (Cmd+K) | Nice but zero edge. |
| Keyboard shortcuts (j/k/r/n) | QoL only. |
| Permalink/shareable state | Already partially done (URL sync in filters). |
| Options chain viewer | **Done** | Copilot | PR #286 |
| Financials page | Endpoint exists, low priority. |
| Journal timeline | **Done** | Copilot | PR #287 — chronological view with outcome colors |

---

## Kill List

Items that have been evaluated and explicitly rejected or pruned. Prevents re-proposing dead ideas.

| Item | Reason | Date |
|------|--------|------|
| *(empty — first quarter)* | | |

**Kill criteria** — add items here when:
- Feature did not increase expectancy after N trades
- Feature increased variance without improving mean
- Feature added complexity without measurable lift
- Feature was cosmetic and consumed edge-experiment time

**Review cadence**: Quarterly. Prune anything that's been "Not started" for 2+ quarters without a thesis justification.

---

## Completed Phases (Changelog)

<details>
<summary>Phase 0: Testing Foundation (COMPLETE)</summary>

| Task | PR | Status |
|------|----|--------|
| Vitest + in-memory SQLite | #30 | Merged |
| Feature engine unit tests (14 modules) | #31 | Merged |
| Ensemble scorer unit tests | #34 | Merged |
| Risk gate unit tests | #36 | Merged |
</details>

<details>
<summary>Phase 1: Core Dashboard (COMPLETE)</summary>

Next.js 14 scaffolding, 7 pages, typed API client, React Query hooks, sidebar nav, eval history table, eval detail with 3-model side-by-side.
</details>

<details>
<summary>Phase 2: Complete Eval UI (COMPLETE)</summary>

| Component | PR | Status |
|-----------|----|--------|
| Score scatter | #11 | Merged |
| Feature radar | #23 | Merged |
| Time-of-day chart | #13 | Merged |
| Weight sliders | #12 | Merged |
| CSV/JSON export | #33 | Merged |
| Eval trigger form | #29 | Merged |
| Outcome recording | #32 | Merged |
| Eval filters | #37 | Merged |
| Model stats page | #38 | Merged |
</details>

<details>
<summary>Phase 3: Trading Workflow (COMPLETE)</summary>

| Component | PR | Status |
|-----------|----|--------|
| Account summary + P&L | #50 | Merged |
| Positions table | #49 | Merged |
| Order management | #52 | Merged |
| Executions log | #51 | Merged |
</details>

<details>
<summary>Phase 4: Journal & Collaboration (COMPLETE)</summary>

| Component | PR | Status |
|-----------|----|--------|
| Journal entry form | #53 | Merged |
| Journal history table | #54 | Merged |
| Collab channel feed | #55 | Merged |
</details>

---

## API Dependency Monitoring

Automated weekly audit via `.github/workflows/api-audit.yml` + `scripts/api-audit.mjs`.

**Schedule:** Every Monday 9:00 AM ET.

| Deadline | Item | Status |
|----------|------|--------|
| ~~2026-03-31~~ | gemini-2.0-flash shutdown | Done — migrated to gemini-2.5-flash |
| ~~2026-06-24~~ | @google/generative-ai deprecated | Done — migrated to @google/genai (PR #44) |
| ~~TBD~~ | openai v4→v6 | Done — upgraded to 6.21 |
| ~~TBD~~ | @anthropic-ai/sdk 0.39→0.74 | Done — commit 012b145 |
| 2026-06-30 | yahoo-finance2 v3 | Pinned ~3.13.0. Monitor for release. |
| TBD | @stoqey/ib 10.42 | Watch for one-message brackets |

---

## Agent Delegation Summary

| Agent | Strength | Danger Zone |
|-------|----------|-------------|
| **Copilot** | Self-contained UI, clear props/API specs, CRUD | Cross-cutting risk logic, state reconciliation |
| **Codex** | Long-running features, analytics, Python scripts | Execution path modifications, capital constraints |
| **Claude Code** | Architecture, backend routes, cross-file wiring | Over-automating edge-critical decisions |

---

## Weekly Triage Cycle

1. **Thesis check**: Does any active work serve A (structure edge), B (probability weighting), or C (regime conditioning)?
2. **Check issues + PRs**: Review agent PRs, merge or reject
3. **Surface new items**: Usage gaps, dependency alerts, post-trade insights
4. **Score**: Apply 5-dimension scoring (EI × 2 + Value + Dependency) / Effort
5. **Ship / backlog / kill**: High EI ships. Low EI backlogs. Dead ideas go to kill list.
6. **Update roadmap**: Keep this file directional, not a changelog.

**Guardrail**: If edge experiments are < 40% of active work, you're drifting.
