# Analytics Decision Matrix

> Decision policy for analytics architecture. This is a routing rule, not an options buffet.
> Updated: 2026-02-22

## Architecture Constraint

**TS-first, single-process.** All production runtime computation happens in the Node.js bridge.
Python is an offline research tool — not a runtime dependency, not a microservice.

## Decision Matrix

| Need | TS in-bridge | Python offline | TSDB | Choose when... |
|------|:---:|:---:|:---:|----------------|
| Streaming indicators (EMA, RSI, MACD, BB, ATR) | **YES** | — | — | Always. `trading-signals` with `.add()` per bar. |
| VWAP | **YES** | — | — | Custom streaming impl (sum(TP*V)/sum(V)). Not in trading-signals. |
| Indicator correctness validation | — | **YES** | — | Use TA-Lib in Python to validate TS indicator output matches. |
| Historical backtesting | — | **YES** | — | `vectorbt` or existing `VectorizedBacktester`. Offline research. |
| Parameter sweeps / optimization | — | **YES** | — | `optuna` + `xgboost`/`lightgbm`. Walk-forward validation. |
| ML signal classification | — | **YES** | — | Build on existing HMM regime model. Write results to SQLite. |
| Feature importance / explainability | — | **YES** | — | `shap`. Prevents overfitting. Offline analysis only. |
| Pattern recognition | — | **YES** | — | TA-Lib candlestick patterns. Batch analysis. |
| Candlestick charting | **YES** (frontend) | — | — | `lightweight-charts` in React. Keep `recharts` for non-OHLCV. |
| Tick replay at scale | — | — | Evaluate | Only if storing >1M ticks/day for replay/debugging. Not now. |
| L2 order book analysis | Evaluate | — | — | Only after defining a measurable use case (entry timing, stop placement). |

## What We Will NOT Do (Yet)

- **No TSDB migration** until replay need is proven (SQLite WAL is sufficient)
- **No live L2 ingestion** until a feature is defined + impact measurable
- **No runtime Python sidecar** until the single-process constraint is revisited
- **No IBKR Web API** — same flakiness source (TWS), worse streaming throughput
- **No library swap for IBKR** — `@stoqey/ib` isn't the problem, TWS is. Fix the architectural bugs instead.

## Feature Contract

The bridge computes and exposes this schema per tracked symbol (see `src/indicators/schema.ts`):

```
symbol, ts_et, source
price: last, bid, ask, spread_pct
bar_1m: open, high, low, close, volume
volume: cumulative, rvol_20d
trend: ema_9, ema_21, vwap, vwap_dev_pct
momentum: rsi_14, macd_line, macd_signal, macd_histogram
volatility: atr_14_pct, bollinger_upper, bollinger_lower, bb_width_pct
range: high_of_day, low_of_day, range_pct, range_position
gap: prior_close, gap_pct
flags[]: spread_wide, rvol_low, small_cap, illiquid, extended_hours, atr_elevated
```

Everything else is optional modules. This is the stable interface.

## IBKR Connection: What Actually Needs Fixing

The connection is not an `@stoqey/ib` problem — it's TWS + architectural bugs:

1. **Listener leak on reconnect** — Order listeners stay on dead IBApi instance. Fix: clean up listeners in `destroyIB()`.
2. **Stale subscription maps** — `symbolKeyToReqId` can reference deleted reqIds. Fix: validate on lookup.
3. **Heartbeat thrashing** — 60s interval + 10s timeout causes excessive reconnection on network jitter. Fix: increase tolerance.
4. **Fragile callback ordering** — Three subsystems register `onReconnectCallbacks` with no ordering guarantee. Fix: define explicit phases.
5. **ClientId exhaustion** — Stuck forever after 5 retries. Fix: reset and start over.

## Exposure

### MCP Tools
- `get_indicators` — snapshot for one symbol (EMA, RSI, MACD, BB, ATR, VWAP, flags)
- `get_all_indicators` — snapshots for all tracked symbols
- `get_tracked_symbols` — list symbols with active indicator engines

### REST Endpoints
- `GET /api/indicators/:symbol` — feature snapshot for a symbol
- `GET /api/indicators` — all snapshots

### Tests
- 38 unit tests in `src/indicators/__tests__/engine.test.ts`

## Installed Libraries

### Backend (`package.json`)
- `trading-signals` — streaming indicators (EMA, RSI, MACD, BB, ATR)

### Frontend (`frontend/package.json`)
- `lightweight-charts` — TradingView OHLCV charting (45KB, Canvas-based)

### Python (`analytics/requirements.txt`)
- `TA-Lib` — batch indicator computation + pattern recognition (offline research)

### Deferred (install when needed)
- `backtrader`, `optuna`, `quantstats` — backtesting + optimization (Tier 2)
- `hmmlearn`, `xgboost`, `lightgbm`, `shap` — ML signal layer (Tier 3)
- `riskfolio-lib` or `skfolio` — portfolio optimization (Tier 3)
- `rxjs` — stream composition (evaluate if current event patterns become unwieldy)
- `nodejs-order-book` — L2 book (Tier 3, requires defined use case)
