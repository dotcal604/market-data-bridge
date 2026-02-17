# Market Data Bridge — User Guide

*For traders using AI assistants (Claude, ChatGPT) to monitor markets, analyze setups, and execute trades through Interactive Brokers.*

---

## What This Is

Market Data Bridge connects your Interactive Brokers account to AI assistants. It provides:

- **Market data** — real-time quotes, historical bars, options chains, news, screeners, fundamentals
- **Trade execution** — place, modify, and cancel orders through AI conversation
- **Portfolio monitoring** — account balances, positions, P&L, risk exposure
- **3-model evaluation engine** — Claude, GPT-4o, and Gemini score trade setups as an ensemble
- **Holly AI integration** — import Trade Ideas Holly alerts, analyze patterns, optimize exits
- **Risk management** — session guardrails, position sizing, daily loss limits
- **Trade journaling** — record reasoning, outcomes, and performance analytics
- **Dashboard** — Next.js web UI at `http://localhost:3001` for visual review

---

## Starting Up

### Prerequisites

1. **TWS or IB Gateway** — open and logged in (API connections enabled)
2. **The bridge** — Node.js backend process
3. **AI assistant** — Claude Desktop (MCP) or ChatGPT (REST API)

### Start the Bridge

```bash
cd market-data-bridge

# Both MCP + REST (default)
npm start

# REST only (for ChatGPT)
npm start -- --mode rest

# MCP only (for Claude Desktop)
npm start -- --mode mcp

# Paper trading (port 7497)
npm run start:paper
```

You should see:
```
[market-bridge] REST server listening on http://localhost:3000
[market-bridge] Connected to TWS on 127.0.0.1:7497
```

### Start the Dashboard (optional)

```bash
cd frontend
npm run dev
```

Opens at `http://localhost:3001`.

---

## Feature Guide

### 1. Market Data

Ask your AI assistant naturally — it routes to the right tool automatically.

**Quotes and prices:**
> "What's AAPL trading at?"
> "Get me quotes for AAPL, MSFT, and GOOGL."
> "Show me SPY's last 30 days of daily bars."
> "5-minute bars for TSLA from today."

**Options:**
> "What option expirations are available for AAPL?"
> "Price the AAPL March 2026 220 call."
> "Show me the full options chain for SPY."

**Research:**
> "What are the top gainers today?"
> "Get me financials for NVDA."
> "What's the analyst consensus on MSFT?"
> "Show me recent news for TSLA."
> "Search for companies with 'solar' in the name."

**Data sources:** IBKR real-time when connected, Yahoo Finance as automatic fallback. Historical bars, fundamentals, screeners, and news always come from Yahoo (no IBKR subscription needed).

---

### 2. Account and Portfolio

> "What's my account summary?"
> "What positions do I have?"
> "How's my P&L today?"
> "What's my portfolio exposure breakdown?"

**Portfolio analytics** go beyond basic account data:

> "Run a stress test — what happens if the market drops 5%?"
> "Show me my portfolio exposure by sector."
> "What's my beta-weighted exposure?"

The **exposure** report shows gross/net exposure, % of equity deployed, largest position, sector breakdown, and portfolio heat score.

---

### 3. Order Execution

The bridge can place, modify, and cancel orders through IBKR.

**Single orders:**
> "Buy 100 shares of AAPL at market."
> "Place a limit buy for 50 MSFT at $420."
> "Sell 200 SPY with a stop at $580."

**Bracket orders (entry + take profit + stop loss):**
> "Buy 100 AAPL at market, take profit at $250, stop loss at $230."

**Advanced brackets** support trailing stops, adaptive algos, and OCA groups:
> "Buy 100 AAPL at market with a 2% trailing stop and take profit at $260."

**Order management:**
> "What are my open orders?"
> "Cancel order 47."
> "Modify order 52 — change the limit to $425."
> "Cancel all open orders."
> "Flatten all positions." *(closes everything with market orders)*

**Supported order types:** MKT, LMT, STP, STP LMT, TRAIL, TRAIL LIMIT, REL, MIT, MOC, LOC, PEG MID.

---

### 4. Risk Management

#### Session Guardrails

The session risk gate tracks your trading day and enforces limits:

> "What's my session state?"
> "Lock my session — I'm stepping away."
> "Unlock my session."
> "Reset session counters."

**Automatic protections:**
- Daily loss limit (locks session when exceeded)
- Consecutive loss cooldown
- Trade count limits
- Manual lock/unlock

#### Position Sizing

> "Size a position for AAPL — entry at $240, stop at $235."

Returns the maximum safe position size based on:
- Account equity and buying power
- Risk per trade (default 1% of net liquidation)
- Maximum capital concentration (default 10%)
- Volatility regime adjustment

#### Risk Configuration

> "Show me the risk config."
> "Tune risk parameters from my last 100 trades."

Auto-tuning uses half-Kelly sizing on your actual trade outcomes.

---

### 5. Evaluation Engine (3-Model Ensemble)

The eval engine collects independent trade setup scores from three AI models and combines them into a weighted ensemble score.

> "Score AAPL as a trade setup."
> "Run multi-model consensus on MSFT."

Each evaluation returns:
- **Per-model scores** (Claude, GPT-4o, Gemini) on a 0–100 scale
- **Ensemble score** — weighted average with disagreement penalty
- **Should-trade verdict** — whether the setup passes the score threshold
- **Model reasoning** — key drivers, risk factors, and uncertainties from each model

#### Weight Tuning

Model weights control how much each model contributes to the ensemble:

> "Simulate weights: Claude 0.5, GPT 0.3, Gemini 0.2."
> "Show me the weight history."

The **Weight Tuner** page in the dashboard lets you adjust sliders and see simulated impact before applying changes. Auto-tune optimizes weights from your outcome history.

#### Drift Detection

> "Show me the drift report."
> "Any drift alerts?"

Monitors model accuracy over rolling windows, calibration error by score decile, and regime-shift detection. Alerts fire when metrics fall below thresholds.

#### Outcome Tracking

After trades close, record the outcome to build your performance dataset:

> "Record outcome for evaluation abc123 — trade taken, R-multiple 1.5, exited at target."

Outcomes feed into edge analytics, weight tuning, and drift detection.

---

### 6. Edge Analytics

> "Show me my edge report."
> "Run walk-forward validation."

The edge report includes:
- **Rolling Sharpe and Sortino ratios**
- **Win rate and profit factor**
- **Maximum drawdown**
- **Expectancy per trade**
- **Feature attribution** — which setup features predict winners
- **Walk-forward validation** — out-of-sample proof that your edge isn't just luck

---

### 7. Holly AI Integration

For traders using Trade Ideas Holly AI alerts. Import alerts and trades, then analyze patterns and optimize exits.

#### Alert Import

Holly alerts can be imported from CSV files (exported from Trade Ideas):

> "Import these Holly alerts." *(paste CSV content)*
> "Show me Holly alerts for today."
> "What Holly symbols are active?"

The bridge also supports a **file watcher** that auto-imports new alerts from Trade Ideas' Alert Logging CSV file (configure `HOLLY_WATCH_PATH` in `.env`).

#### Auto-Eval Pipeline

When enabled, incoming Holly alerts are automatically scored through the 3-model ensemble:

> "Enable auto-eval."
> "Show me the signal feed."
> "What's the auto-eval status?"

The **Signals** page in the dashboard shows a live feed of evaluated alerts with ensemble scores and should-trade verdicts.

#### Predictor and Rule Extraction

> "What's the Holly predictor status?"
> "Scan AAPL against Holly profiles."
> "Show me the top pre-alert candidates."
> "Extract Holly alert rules."
> "Backtest extracted rules."
> "Break down Holly strategies."

The predictor learns feature profiles from historical alerts and scans new symbols for matches using z-score analysis. Rule extraction reverse-engineers trigger conditions using Cohen's d effect size.

#### Trade Import and Exit Analysis

> "Show me Holly trade stats."
> "Run the exit autopsy."

Import Holly trade history (with MFE/MAE/giveback metrics computed automatically) to analyze:
- **Strategy leaderboard** — expectancy, Sharpe, profit factor per strategy
- **MFE/MAE profiles** — how much winners give back before exit
- **Exit policy recommendations** — early peaker vs late grower vs bleeder archetypes
- **Time-of-day performance** — when each strategy works best

#### Trailing Stop Optimization

> "Show me the trailing stop summary."
> "Optimize trailing stops per strategy."
> "What trailing stop parameters are available?"

Runs 19 different trailing stop strategies (fixed-%, ATR-based, time-decay, MFE-escalation, breakeven+trail) against historical trade data and ranks them by P&L improvement.

---

### 8. Trade Journal

> "Create a journal entry for AAPL — breakout setup, high confidence, following rules."
> "Show me my recent journal entries."
> "Update journal entry 15 with outcome: hit target, +1.5R."

Journal entries track:
- Pre-trade reasoning and setup type (breakout, pullback, reversal, gap fill, momentum)
- Confidence rating (1–3)
- Whether you followed your own rules
- Post-trade notes and outcome tags
- Market context (SPY price, VIX level)

---

### 9. AI Collaboration Channel

A shared messaging channel between Claude, ChatGPT, and the user:

> "Read the latest collab messages."
> "Post to collab: AAPL looks strong above 240, watching for pullback entry."
> "Show collab stats."

Use it for multi-AI analysis handoffs — have one AI analyze the setup, another review the risk, and coordinate through the channel.

---

### 10. Dashboard Pages

The Next.js dashboard at `http://localhost:3001` provides visual interfaces:

| Page | What It Shows |
|------|---------------|
| **/** | Overview dashboard with ensemble stats, recent evals, Holly alerts |
| **/market** | Symbol search, quotes, price charts, company info, news |
| **/account** | Account summary, positions, flatten controls |
| **/orders** | Place orders, view open/completed orders |
| **/executions** | Trade execution history with fills and commission |
| **/screener** | Stock screeners (7 types) with sortable results |
| **/evals** | 3-model ensemble scores, trigger new evals, calibration curves |
| **/session** | Session risk gate state, position sizer, risk config |
| **/weights** | Ensemble weight management and history |
| **/weights/tune** | Interactive weight tuner with live simulation |
| **/drift** | Model accuracy rolling windows, calibration error, regime detection |
| **/edge** | Sharpe/Sortino curves, equity curve, feature attribution |
| **/journal** | Trade journal entries with reasoning and outcomes |
| **/signals** | Auto-evaluated Holly alerts with ensemble scores |
| **/collab** | AI collaboration channel message feed |
| **/holly/autopsy** | Holly exit analysis, strategy leaderboard, MFE/MAE scatter |
| **/holly/performance** | Trailing stop optimization, per-strategy performance |
| **/status** | System status, IBKR connection, market session |

---

## Configuration

Key environment variables in `.env`:

```bash
# IBKR connection (paper: 7497, live: 7496)
IBKR_HOST=127.0.0.1
IBKR_PORT=7497
IBKR_CLIENT_ID=0

# REST API
REST_PORT=3000

# AI model keys (for eval engine)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...

# Holly file watcher (optional)
HOLLY_WATCH_PATH=C:\Users\you\Documents\TradeIdeasPro\alerts.csv
HOLLY_POLL_INTERVAL_MS=5000

# Auto-eval pipeline (off by default)
AUTO_EVAL_ENABLED=false

# Drift alerts
DRIFT_ALERTS_ENABLED=true
DRIFT_ACCURACY_THRESHOLD=0.55

# Divoom display (optional)
DIVOOM_ENABLED=false
DIVOOM_DEVICE_IP=192.168.1.x
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| AI says tools aren't available | Check bridge is running. For Claude, restart Claude Desktop. |
| All data returns null | Check TWS is logged in. Bridge retries connection automatically. |
| Symbol not found | Use the search feature first. Check ticker is correct. |
| ChatGPT can't reach server | ngrok tunnel may have stopped. Restart it. |
| Prices seem delayed | Paper accounts have 15–20 min delay (IBKR limitation). |
| Order rejected | Check risk gate session state. May be locked or in cooldown. |
| Eval returns no score | Check that API keys are set for all three models in `.env`. |
| Holly watcher not importing | Verify `HOLLY_WATCH_PATH` points to the correct CSV file. |
| Dashboard won't load | Run `cd frontend && npm run dev`. Check port 3001 is free. |

---

## Quick Reference

| You Want To... | Say Something Like... |
|---|---|
| Get a quote | "What's AAPL trading at?" |
| Historical bars | "Show me SPY's last 30 days" |
| Options chain | "What options are available for AAPL?" |
| Account summary | "What's my account balance?" |
| Check positions | "What am I holding?" |
| Today's P&L | "How's my P&L today?" |
| Place an order | "Buy 100 AAPL at market" |
| Bracket order | "Buy 100 AAPL, TP at $250, SL at $230" |
| Cancel orders | "Cancel all open orders" |
| Flatten everything | "Flatten all positions" |
| Score a setup | "Score AAPL as a trade setup" |
| Position size | "Size a position: AAPL entry $240, stop $235" |
| Session state | "What's my session state?" |
| Edge analytics | "Show me my edge report" |
| Holly alerts | "Show me today's Holly alerts" |
| Exit analysis | "Run the Holly exit autopsy" |
| Journal entry | "Create a journal entry for AAPL" |
| Collab message | "Post to collab: watching AAPL breakout" |
| Trailing stops | "Optimize trailing stops per strategy" |
| Drift check | "Any drift alerts?" |
| Stress test | "What happens if the market drops 5%?" |

---

## Glossary

| Term | Definition |
|---|---|
| **TWS** | Trader Workstation — IBKR's desktop trading application |
| **IB Gateway** | Lightweight headless alternative to TWS |
| **Bridge** | This software — connects TWS to AI assistants |
| **MCP** | Model Context Protocol — how Claude connects to external tools |
| **Ensemble** | Weighted combination of scores from 3 AI models |
| **Eval** | A scored trade setup evaluation from the 3-model engine |
| **R-multiple** | Trade outcome as a multiple of initial risk (1R = risked amount) |
| **Holly AI** | Trade Ideas' AI alert system that flags trade setups |
| **MFE / MAE** | Maximum Favorable / Adverse Excursion — best and worst price during a trade |
| **Giveback** | How much of MFE was surrendered before exit |
| **Drift** | When model performance degrades over time |
| **Risk gate** | Pre-trade checks that block orders violating risk rules |
| **Flatten** | Close all positions and cancel all orders |
| **Paper account** | Simulated IBKR account for practice (delayed data) |
| **Walk-forward** | Out-of-sample validation that slides a train/test window across history |
