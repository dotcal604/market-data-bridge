# Analytics Roadmap

> Concrete implementation plan based on research survey (Feb 2026).
> Architecture constraint: **TS-first, single-process runtime. Python is offline research only.**

---

## Current State (Tier 1 — Done)

| Component | Status | Location |
|-----------|--------|----------|
| Streaming indicators (EMA, RSI, MACD, BB, ATR) | **Shipped** | `src/indicators/engine.ts` |
| VWAP (custom streaming impl) | **Shipped** | `src/indicators/engine.ts` |
| Feature snapshot schema | **Shipped** | `src/indicators/schema.ts` |
| MCP tools (`get_indicators`, `get_all_indicators`, `get_tracked_symbols`) | **Shipped** | `src/mcp/server.ts` |
| REST routes (`/api/indicators/:symbol`, `/api/indicators`) | **Shipped** | `src/rest/routes.ts` |
| Candlestick charting (lightweight-charts) | **Shipped** | `frontend/src/components/market/CandlestickChart.tsx` |
| Subscription → indicator engine wiring | **Shipped** | `src/ibkr/subscriptions.ts` |
| Unit tests (38 tests) | **Shipped** | `src/indicators/__tests__/engine.test.ts` |

**Library:** `trading-signals` (TS, streaming `.add()` API)

---

## Tier 2 — Python Research Sidecar (Next)

Offline tools for backtesting, optimization, and model evaluation. NOT runtime dependencies.

### 2a. Backtesting Engine

**Recommended:** Backtrader (Python)
- Native IBKR broker adapter — only framework with built-in TWS integration
- Simple path from backtest to paper/live trading
- Well-documented, large community
- GPL v3 license (acceptable for internal tooling)

**Alternative:** QuantConnect LEAN
- C# core with Python 3.11 strategy support
- Docker-based local runner via Lean CLI
- Native IBKR integration via plugin
- Better for institutional-grade simulation but heavier setup

**Install:** `pip install backtrader` (add to `analytics/requirements.txt`)

### 2b. Parameter Optimization

**Recommended:** Optuna
- Tree-structured Parzen Estimator (TPE) for efficient search
- Pruning to terminate unpromising trials early
- Multi-objective via NSGA-II (maximize Sharpe while minimizing drawdown)
- SQLite study storage — results persist and MCP server can read them
- Walk-forward validation: train on rolling windows, test on holdout

**Install:** `pip install optuna`

### 2c. Performance Reporting

**Recommended:** QuantStats
- HTML tear sheet generation (Sharpe, Sortino, Calmar, max drawdown, win rate, Kelly, VaR, CVaR)
- Built-in Monte Carlo simulations with bust/goal probability
- Drop-in pandas integration

**Install:** `pip install quantstats`

### 2d. Indicator Validation (Already Installed)

**TA-Lib** — validate that `trading-signals` output matches TA-Lib batch output.
Cross-validate EMA, RSI, MACD, BB, ATR against TA-Lib reference implementation.

---

## Tier 3 — ML Signal Layer (Future)

Build on existing HMM regime model in `analytics/`. These are research tools, not runtime.

### 3a. Market Regime Detection

**Recommended:** hmmlearn (Gaussian HMM)
- 2-3 states: low-vol / high-vol (or bull / bear / sideways)
- Features: daily log returns + realized volatility
- Use regime labels to adjust position sizing in `size_position`
- Existing code in `analytics/regime_model.py` — extend, don't rewrite

**Pipeline:**
1. Fetch historical bars via Yahoo (`get_historical_bars`)
2. Run HMM via Python subprocess
3. Return regime classification + confidence
4. Store in SQLite for MCP tools to read

### 3b. Feature Engineering

**Recommended:** tsfresh
- Extracts 794 features from a single time series
- Built-in feature filtering via hypothesis tests
- Use to identify which features actually predict outcomes

**Alternative for ensemble:** XGBoost / LightGBM
- Gradient boosting on technical indicators + regime features
- Often outperforms deep learning for tabular financial data

### 3c. Volatility Estimation

**Recommended:** `arch` package (GARCH/EGARCH)
- Captures volatility persistence and leverage effects
- Use for forward-looking volatility estimates
- Feed into ATR-based position sizing

### 3d. Portfolio Optimization

**Recommended:** Riskfolio-Lib
- 24 convex risk measures, Kelly Criterion support
- Built on CVXPY (any supported solver)
- Use for multi-position portfolio construction

**Alternative:** skfolio (scikit-learn API)
- `fit`/`predict`/`transform` paradigm
- Cross-validation for portfolio models

---

## Tier 4 — Strategy Deployment Bridge (Later)

### StrateQueue
- Deploy any Python backtesting framework to IBKR live with one command
- `stratequeue deploy --strategy ./your_script.py`
- Unified API across IBKR, Alpaca, and 250+ brokers
- Evaluate only after Tier 2 backtesting is proven

---

## What We Will NOT Build

| Idea | Why Not |
|------|---------|
| Runtime Python sidecar | Violates single-process constraint |
| TSDB migration | SQLite WAL is sufficient until >1M ticks/day |
| L2 order book ingestion | No defined use case yet |
| Deep RL trading (FinRL) | Research-oriented, requires GPU, overkill for current use |
| NautilusTrader | Extreme performance but steep learning curve; Backtrader is simpler |
| VectorBT PRO | Paid subscription; free version frozen |
| Custom alpha mining (Alpha-GPT, AlphaSAGE) | Cutting-edge research, not production-ready |

---

## JS/TS Libraries Evaluated (for reference)

| Library | Verdict | Notes |
|---------|---------|-------|
| `trading-signals` | **Adopted** | Streaming API, production-tested |
| `indicatorts` | Consider | Zero-dep alternative, built-in backtesting |
| `backtest-kit` | Evaluate later | Pine Script compat, React UI, most feature-rich JS option |
| `quantlib.js` | Evaluate later | Options pricing / risk math if needed |
| `@backtest/framework` | Skip | SQLite-backed, but Backtrader (Python) is stronger |
| `grademark` | Skip | Pre-1.0, sparse docs |

---

## Immediate Next Steps

1. ~~Write indicator engine tests~~ ✅ (38 tests)
2. ~~Expose indicators via MCP + REST~~ ✅ (3 MCP tools, 2 REST routes)
3. Cross-validate trading-signals output vs TA-Lib (Python script)
4. Add WebSocket streaming for indicator snapshots (real-time dashboard updates)
5. Integrate indicator flags into existing scan outputs (spread_wide, rvol_low, illiquid)
6. Set up Backtrader with IBKR adapter for first offline backtest
