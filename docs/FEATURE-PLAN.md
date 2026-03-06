# Feature Implementation Plan — March 2026

> Generated from Holly Exit Optimizer results + Benzinga integration + Analytics Roadmap
> Agent delegation follows ORCHESTRATION.md cost-aware routing

---

## Phase 1: Holly Exit Integration (Layer 2 → Layer 1)

The Holly Exit Optimizer (analytics/holly_exit/) produced `optimal_exit_params.json` with 34 strategy configurations. These need to flow into the live MCP server.

### 1a. Exit Params MCP Tool — **Claude Code** (2h)

Create `get_holly_exit_params` MCP tool that reads `optimal_exit_params.json` and returns optimized exit rules per strategy. This is the bridge from offline research → live trading assistant.

**Files:**
- `src/holly/exit-params.ts` — Load + cache JSON, expose typed interface
- `src/mcp/server.ts` — Register tool
- `src/rest/routes.ts` — `GET /api/holly/exit-params`

**Why Claude Code:** Touches 3+ files, wires subsystems together, needs MCP registration.

### 1b. Auto-Apply Exit Rules to Holly Alerts — **Claude Code** (4h)

When a Holly alert fires for a strategy (e.g. "Downward Dog"), automatically look up its optimal exit rule (e.g. `fixed_trail` with `trail_pct: 0.8%`) and include it in the alert response / trade journal entry.

**Files:**
- `src/holly/auto-eval.ts` — Modify to include exit params in evaluation
- `src/holly/exit-params.ts` — Strategy→exit_rule lookup function
- `src/mcp/server.ts` — Enhance `get_holly_alerts` response

**Why Claude Code:** Core integration logic, touches evaluation pipeline.

### 1c. Fix Direction Inference Bug — **Claude Code** (2h)

Optimization results show suspicious P&L for some strategies (Bull Trap: $1.85B, Count De Monet: -$1.37B). Root cause: 747 trades with `direction_int=0` ("Unknown" direction) are likely being simulated incorrectly. Fix in the optimizer's direction inference logic.

**Files:**
- `analytics/holly_exit/engine/data_loader.py` — Direction inference heuristic
- `analytics/holly_exit/scripts/05_run_optimization.py` — Re-run after fix

**Why Claude Code:** Requires understanding of the full optimization pipeline.

### 1d. Exit Optimization Dashboard — **v0 by Vercel** (3h) → **Copilot** (2h)

Visualize the optimization results: strategy comparison table, equity curves, heatmaps.

**Files:**
- `frontend/src/app/analytics/exit-optimizer/page.tsx` — New page
- `frontend/src/components/analytics/StrategyTable.tsx` — Sortable comparison
- `frontend/src/components/analytics/HeatmapChart.tsx` — Parameter heatmap

**Why v0:** UI component generation from specs. Copilot polishes + wires to API.

---

## Phase 2: Benzinga Enhancement

Benzinga is now wired via IBKR (3 MCP tools, 3 REST endpoints). Enhance with intelligence.

### 2a. Headline Sentiment Scoring — **Codex** (3h)

Extract bullish/bearish/neutral sentiment from Benzinga headlines using keyword heuristics. No ML model needed initially.

**Files:**
- `src/providers/benzinga.ts` — New file: sentiment extraction, keyword dictionaries
- `src/ibkr/news.ts` — Enhance `HistoricalNewsHeadline` interface with sentiment field

**Keyword approach:**
- Bullish: "beat", "upgrade", "raised", "outperform", "positive", "strong"
- Bearish: "miss", "downgrade", "cut", "underperform", "negative", "weak"
- Neutral: everything else

**Why Codex:** Single-file focus, clear spec, follows keyword dictionary pattern.

### 2b. Unified News Feed — **Copilot** (2h)

Merge Yahoo `getNews()` and Benzinga `getBenzingaNews()` into a single `getUnifiedNews(symbol)` function that deduplicates by headline similarity.

**Files:**
- `src/providers/news-aggregator.ts` — New file: merge + deduplicate
- `src/mcp/server.ts` — Register `get_unified_news` tool
- `src/rest/routes.ts` — `GET /api/news/unified/:symbol`

**Why Copilot:** Follows existing provider pattern, self-contained.

### 2c. News-Triggered Alerts — **Claude Code** (3h)

Monitor Benzinga for high-impact headlines on watched symbols. Fire alert when coverage spikes.

**Files:**
- `src/scheduler.ts` — Add Benzinga polling interval (30s during market hours)
- `src/providers/benzinga.ts` — Coverage spike detection logic
- `src/collab/store.ts` — Post alerts to collab channel

**Why Claude Code:** Scheduler integration, touches multiple subsystems.

---

## Phase 3: Analytics Infrastructure (from Roadmap Tier 2)

### 3a. WebSocket Indicator Streaming — **Claude Code** (4h)

Add WebSocket endpoint for real-time indicator updates. Currently REST-only (polling).

**Files:**
- `src/rest/websocket.ts` — New file: WS upgrade handler
- `src/indicators/engine.ts` — Add subscriber callbacks on snapshot update
- `src/index.ts` — Wire WS server to HTTP server

**Why Claude Code:** Architecture decision, core infrastructure.

### 3b. Indicator Flags in Scan Output — **Copilot** (2h)

Add `rsi_overbought`, `macd_bullish_cross`, `bb_squeeze`, `vwap_above` flags to screener results.

**Files:**
- `src/providers/yahoo.ts` — Enhance `runScreenerWithQuotes` response
- `src/indicators/engine.ts` — Add flag derivation functions

**Why Copilot:** Pattern-following enhancement, existing code structure.

### 3c. Cross-Validate Indicators vs TA-Lib — **Codex** (2h)

Python script to validate `trading-signals` output matches TA-Lib reference.

**Files:**
- `analytics/validate_indicators.py` — Comparison script
- `analytics/requirements.txt` — Add TA-Lib

**Why Codex:** Single-file Python script, clear spec.

---

## Phase 4: Holly Predictor Enhancement

### 4a. Pre-Alert Scoring Model — **Claude Code** (6h)

Improve `buildProfiles()` and `scanSymbols()` with features from the exit optimizer results. Weight strategies by their optimized Sharpe ratio.

**Files:**
- `src/holly/predictor.ts` — Enhance profile building with exit quality metrics
- `src/holly/exit-params.ts` — Strategy quality ranking

**Why Claude Code:** Complex ML pipeline, core trading logic.

### 4b. Strategy-Specific Position Sizing — **Claude Code** (3h)

Use per-strategy risk metrics (win rate, profit factor, Sharpe) from exit optimizer to adjust position sizing. High-Sharpe strategies get larger allocations.

**Files:**
- `src/ibkr/risk.ts` — Strategy-aware sizing multiplier
- `src/holly/exit-params.ts` — Provide risk metrics per strategy

**Why Claude Code:** Core risk management logic.

### 4c. Walk-Forward Validation — **Codex** (4h)

Extend `analytics/holly_exit/` with walk-forward validation: train on first 70% of trades, test on remaining 30%. Mark strategies as `validated: true/false`.

**Files:**
- `analytics/holly_exit/scripts/06_validate.py` — Walk-forward splitter
- `analytics/holly_exit/engine/optimizer.py` — Accept train/test masks

**Why Codex:** Self-contained Python, clear algorithm spec.

---

## Phase 5: Infrastructure & DevEx

### 5a. Frontend Dashboard Polish — **v0** (4h) → **Copilot** (3h)

Design and implement missing dashboard pages: portfolio heat map, session P&L tracker, Holly alert log.

**Why v0:** Design from specs. **Copilot:** Wire to API + polish.

### 5b. Test Coverage for New Features — **Qodo Gen** (2h)

Generate unit tests for all Phase 1-3 features.

**Files:** `src/**/__tests__/*.test.ts` — edge cases, error paths

**Why Qodo Gen:** QA automation, edge case discovery.

### 5c. Documentation Update — **Mintlify** (1h)

Update API docs with new Benzinga endpoints and Holly exit tools.

**Why Mintlify:** Auto-deployed on PR merge, docs owner.

---

## Priority Order & Cost Optimization

| Priority | Feature | Agent | Cost | Est. Hours | Edge Impact |
|----------|---------|-------|------|------------|-------------|
| **P0** | 1a. Exit Params MCP Tool | Claude Code | High | 2h | Critical — bridges research → live |
| **P0** | 1c. Fix Direction Bug | Claude Code | High | 2h | Data quality — invalid results |
| **P1** | 2a. Headline Sentiment | Codex | Free | 3h | News edge — pre-market catalyst scoring |
| **P1** | 1b. Auto-Apply Exit Rules | Claude Code | High | 4h | Automation — exit quality at alert time |
| **P1** | 4c. Walk-Forward Validation | Codex | Free | 4h | Confidence — validate before live |
| **P2** | 2b. Unified News Feed | Copilot | $39/mo | 2h | UX — single news source |
| **P2** | 3b. Indicator Flags | Copilot | $39/mo | 2h | Scan quality — richer screening |
| **P2** | 4b. Strategy Position Sizing | Claude Code | High | 3h | Risk management — smart allocation |
| **P3** | 3a. WebSocket Streaming | Claude Code | High | 4h | Infrastructure — real-time dashboard |
| **P3** | 2c. News Alerts | Claude Code | High | 3h | Observation — missed catalyst prevention |
| **P3** | 1d. Exit Dashboard | v0 + Copilot | $39/mo | 5h | Visualization — results review |
| **P4** | 5b. Test Coverage | Qodo Gen | Free | 2h | Quality — regression prevention |
| **P4** | 5c. Docs Update | Mintlify | Free | 1h | DevEx — API documentation |

---

## Agent Delegation Summary

| Agent | Tasks | Total Hours | Cost |
|-------|-------|-------------|------|
| **Claude Code** | 1a, 1b, 1c, 2c, 3a, 4a, 4b | ~24h | Max 20x tokens |
| **Codex** | 2a, 3c, 4c | ~9h | Free (in Pro) |
| **Copilot** | 1d (polish), 2b, 3b, 5a (polish) | ~9h | $39/mo flat |
| **v0** | 1d (design), 5a (design) | ~7h | Free tier |
| **Qodo Gen** | 5b | ~2h | Free |
| **Mintlify** | 5c | ~1h | Free |

**Total estimated: ~52 hours across 6 agents**
**Cost-optimized: ~70% free/cheap, ~30% Claude Code (expensive)**

---

## Execution Order

```
Week 1: P0 — Exit Params Tool + Direction Bug Fix (Claude Code, 4h)
         P1 — Sentiment Scoring (Codex, 3h parallel)
         P1 — Walk-Forward Validation (Codex, 4h parallel)

Week 2: P1 — Auto-Apply Exit Rules (Claude Code, 4h)
         P2 — Unified News + Indicator Flags (Copilot, 4h parallel)

Week 3: P2 — Strategy Position Sizing (Claude Code, 3h)
         P3 — WebSocket Streaming (Claude Code, 4h)
         P3 — Exit Dashboard (v0 → Copilot, 5h)

Week 4: P3 — News Alerts (Claude Code, 3h)
         P4 — Tests + Docs (Qodo Gen + Mintlify, 3h parallel)
```
