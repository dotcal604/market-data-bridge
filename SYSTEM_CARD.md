# Market Data Bridge — System Card

## Overview
You are connected to a **Market Data Bridge** at `https://api.klfh-dot-io.com`. This is a unified trading platform providing real-time market data, IBKR brokerage integration, trade execution, an AI-to-AI collaboration channel, and a **multi-model trade evaluation engine**.

**Authentication:** All `/api/*` requests require `X-API-Key` header.

---

## Architecture

```
Claude (MCP stdio) ←→ Market Data Bridge ←→ ChatGPT (REST + OpenAPI)
                            ↕
                     Yahoo Finance (always)
                     IBKR TWS/Gateway (when running)
                            ↕
                     Eval Engine (integrated)
                       ├─ 14 deterministic features
                       ├─ Claude API  ──┐
                       ├─ GPT-4o API  ──┼─ parallel, identical inputs
                       └─ Gemini API  ──┘
                       └─ Ensemble scorer → guardrails → response
```

- **Claude** connects via MCP tools (hardcodes `author: "claude"` for collab)
- **ChatGPT** connects via REST API + OpenAPI Actions (should use `author: "chatgpt"` for collab)
- **Eval engine** is integrated — calls providers directly (no HTTP hop between bridge and eval)
- **SQLite** (better-sqlite3, WAL mode) — single `data/bridge.db` for orders, journal, collab, evaluations, model outputs, outcomes
- **Single process** — one `npm start`, one port (3000)

---

## Capabilities

### Market Data (always available — Yahoo Finance)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Bridge status, market session, IBKR connection state |
| `/api/quote/{symbol}` | GET | Smart quote — IBKR real-time if connected, Yahoo fallback |
| `/api/history/{symbol}` | GET | Historical OHLCV bars. Query: `period`, `interval` |
| `/api/details/{symbol}` | GET | Company info: sector, industry, market cap, PE, 52wk range |
| `/api/options/{symbol}` | GET | Options chain. Query: `expiration` (YYYYMMDD) |
| `/api/options/{symbol}/quote` | GET | Single option quote. Query: `expiry`, `strike`, `right` (C/P) |
| `/api/search?q=...` | GET | Symbol search by name or partial ticker |
| `/api/news/{query}` | GET | Recent news articles for a ticker |
| `/api/financials/{symbol}` | GET | Revenue, margins, debt, analyst targets |
| `/api/earnings/{symbol}` | GET | Earnings history (actual vs estimate) |
| `/api/trending` | GET | Trending symbols. Query: `region` (default: US) |
| `/api/screener/filters` | GET | Available screener IDs |
| `/api/screener/run` | POST | Run screener. Body: `screener_id`, `count` |
| `/api/screener/run-with-quotes` | POST | Run screener with full quote data |

### IBKR Account Data (requires TWS/Gateway)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/account/summary` | GET | Net liquidation, cash, buying power, margin |
| `/api/account/positions` | GET | All current positions with avg cost |
| `/api/account/pnl` | GET | Daily P&L (daily, unrealized, realized) |
| `/api/account/orders` | GET | All open orders |
| `/api/account/orders/completed` | GET | Filled/cancelled orders |
| `/api/account/executions` | GET | Today's fills. Query: `symbol`, `secType`, `time` |
| `/api/contract/{symbol}` | GET | IBKR contract details. Query: `secType`, `exchange`, `currency` |
| `/api/ibkr/quote/{symbol}` | GET | Direct IBKR real-time quote (bid/ask/last/OHLC/volume) |

### Trade Execution (requires TWS/Gateway)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/order` | POST | Place single order (MKT/LMT/STP/STP LMT) |
| `/api/order/bracket` | POST | Place bracket order (entry + TP + SL) |
| `/api/order/{orderId}` | DELETE | Cancel specific order |
| `/api/orders/all` | DELETE | Cancel ALL open orders |

**Order fields:**
- **Single:** `symbol`, `action` (BUY/SELL), `orderType`, `totalQuantity`, optional: `lmtPrice`, `auxPrice`, `tif`, `secType`, `exchange`, `currency`
- **Bracket:** `symbol`, `action`, `totalQuantity`, `entryType` (MKT/LMT), `takeProfitPrice`, `stopLossPrice`, optional: `entryPrice`, `tif`, `secType`, `exchange`, `currency`

### Trade Journal & History (SQLite)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/journal` | GET | Query trade journal. Query: `symbol`, `strategy`, `limit` |
| `/api/journal` | POST | Create journal entry. Body: `reasoning` (required), `symbol`, `tags` |
| `/api/journal/{id}` | PATCH | Update entry. Body: `outcome_tags`, `notes` |
| `/api/orders/history` | GET | Historical orders. Query: `symbol`, `strategy`, `limit` |
| `/api/executions/history` | GET | Historical executions. Query: `symbol`, `limit` |

### Collaboration Channel (AI-to-AI)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/collab/messages` | GET | Read messages. Query: `since`, `author`, `tag`, `limit` |
| `/api/collab/message` | POST | Post message. Body: `author`, `content`, `replyTo`, `tags` |
| `/api/collab/messages` | DELETE | Clear all messages |
| `/api/collab/stats` | GET | Message counts by author |

**Collab rules:**
- ChatGPT posts with `author: "chatgpt"`
- Claude posts with `author: "claude"`
- User can post with `author: "user"`
- Max 200 messages in memory, max 8000 chars per message
- Use `replyTo` with a message ID to thread responses
- Use `tags` for categorization: `["code-review", "analysis", "question", "trade-idea"]`

---

## Multi-Model Trade Evaluation Engine

### Overview
A **ceteris paribus** evaluation system: 3 frontier LLMs receive identical inputs (same prompt, same features, same temperature) and produce independent trade assessments. No model sees another's output. This isolates model judgment as the only variable.

**Mode: Assist discretion** — the system produces scores and flags. The trader decides. No automated execution.

### Eval Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/eval/evaluate` | POST | Full pipeline: features → prefilter → 3 models → ensemble → guardrails |
| `/api/eval/outcome` | POST | Record actual trade result for a previous evaluation |
| `/api/eval/history` | GET | Recent evaluations. Query: `limit`, `symbol` |
| `/api/eval/stats` | GET | Per-model accuracy, compliance rates, ensemble stats |
| `/api/eval/weights` | GET | Current ensemble weights (claude, gpt4o, gemini, k) |

### Evaluate Request
```json
{
  "symbol": "AAPL",
  "direction": "long",
  "entry_price": 195.50,
  "stop_price": 193.00,
  "notes": "Breakout from consolidation"
}
```

### Evaluate Response
```json
{
  "id": "uuid",
  "symbol": "AAPL",
  "timestamp": "2026-02-12T14:30:00.000Z",
  "prefilter": { "passed": true, "flags": [] },
  "features": { "rvol": 3.2, "atr_pct": 1.8, "spread_pct": 0.05, "..." : "..." },
  "models": {
    "claude": { "trade_score": 72, "should_trade": true, "reasoning": "...", "latency_ms": 1200 },
    "gpt4o": { "trade_score": 68, "should_trade": true, "reasoning": "...", "latency_ms": 900 },
    "gemini": { "trade_score": 55, "should_trade": false, "reasoning": "...", "latency_ms": 800 }
  },
  "ensemble": {
    "trade_score": 63.42,
    "should_trade": true,
    "score_spread": 17,
    "unanimous": false,
    "majority_trade": true
  },
  "guardrail": {
    "allowed": true,
    "flags": ["Mild model disagreement (spread=17)"],
    "trading_window_ok": true
  }
}
```

### Record Outcome
```json
{
  "evaluation_id": "uuid-from-evaluate",
  "trade_taken": true,
  "actual_entry_price": 195.45,
  "actual_exit_price": 198.20,
  "r_multiple": 1.1,
  "exit_reason": "target_hit"
}
```

### 14 Computed Features
All deterministic — no ML, no randomness. Computed from live market data via Yahoo/IBKR.

| Feature | Description |
|---------|-------------|
| `rvol` | Relative volume vs 20-day average |
| `vwap_deviation_pct` | Distance from intraday VWAP (%) |
| `spread_pct` | Bid-ask spread (%) |
| `gap_pct` | Gap from prior close (%) |
| `range_position_pct` | Position within day's range (0-100%) |
| `atr_14` / `atr_pct` | 14-period ATR and ATR as % of price |
| `float_rotation_est` | Volume / estimated float |
| `price_extension_pct` | Distance from key levels in ATR units |
| `volume_acceleration` | Last 5min vol / previous 5min vol |
| `spy_change_pct` / `qqq_change_pct` | Market index changes |
| `market_alignment` | aligned_bull / aligned_bear / mixed / neutral |
| `volatility_regime` | low / normal / high |
| `liquidity_bucket` | small / mid / large |
| `time_of_day` | premarket / open_drive / morning / midday / power_hour / close |

### Ensemble Scoring
- Weighted mean of compliant model scores
- Quadratic disagreement penalty: `k * spread^2 / 10000`
- Majority voting + minimum score threshold (40)
- Weights hot-reloaded from `data/weights.json` (updated by offline Python analytics after 50+ outcomes)

### Guardrails
- **Pre-filters** (before model calls): spread too wide, midday + low RVOL, extended + no volume, premarket negligible volume
- **Behavioral** (after ensemble): trading window 9:30-15:55 ET, consecutive loss streak (max 3), model disagreement severity

---

## Data Flow: Full Evaluation Pipeline

```
POST /api/eval/evaluate { symbol, direction, entry, stop }
  ↓
Feature Engine (14 modules, ~200-500ms)
  → Yahoo/IBKR: quote, daily bars, intraday bars, details
  → Compute: RVOL, VWAP dev, spread, ATR, gap, alignment, etc.
  ↓
Pre-filters (deterministic math checks)
  → PASS → continue to models ($$$)
  → FAIL → return immediately (save API cost)
  ↓
3 Models in Parallel (Promise.allSettled, ~1-5s)
  → Claude + GPT-4o + Gemini
  → Identical prompt, temperature 0, Zod schema validation
  ↓
Ensemble Scorer
  → Weighted mean + disagreement penalty + voting
  ↓
Behavioral Guardrails
  → Trading window, loss streak, disagreement flags
  ↓
Persist to SQLite + Return Response
```

---

## Workflow: Trade Evaluation

1. **Evaluate:** `POST /api/eval/evaluate` with symbol, direction, entry/stop prices
2. **Review:** Check ensemble score, individual model reasoning, guardrail flags
3. **Decide:** Trader makes final call (assist discretion mode)
4. **Execute:** If taking the trade, use `/api/order` or `/api/order/bracket`
5. **Record outcome:** `POST /api/eval/outcome` with actual results for model calibration

---

## Workflow: Trade Execution

1. **Check status:** `GET /api/status` — verify IBKR is connected
2. **Research:** Use quote, history, options, financials endpoints
3. **Evaluate (optional):** `POST /api/eval/evaluate` for multi-model assessment
4. **Confirm with user:** Echo back order details (symbol, side, qty, type, prices)
5. **Execute:** `POST /api/order` or `POST /api/order/bracket`
6. **Verify:** Check open orders or executions

## Workflow: AI Collaboration

1. **Check for messages:** `GET /api/collab/messages`
2. **Read Claude's input:** Filter with `author=claude`
3. **Respond:** `POST /api/collab/message` with `author: "chatgpt"`, content, and optional `replyTo`
4. **Tag conversations:** Use tags like `trade-idea`, `code-review`, `question`

---

## Market Session Reference
- **Pre-market:** 4:00 AM – 9:30 AM ET
- **Regular:** 9:30 AM – 4:00 PM ET
- **After-hours:** 4:00 PM – 8:00 PM ET
- **Closed:** 8:00 PM – 4:00 AM ET, weekends, holidays

Session is determined by `/api/status` → `marketSession` field. Never infer from clock math.

---

## Screener IDs
- `day_gainers` — Top gaining stocks today
- `day_losers` — Top losing stocks today
- `most_actives` — Most actively traded
- `small_cap_gainers` — Small cap gainers
- `undervalued_large_caps` — Undervalued large caps
- `aggressive_small_caps` — Aggressive small cap stocks
- `growth_technology_stocks` — Growth tech stocks

---

## Risk Controls
- **Rate limiting:** 100 req/min global, 10/min for orders, 10/min for eval
- **Pre-trade risk gate:** max order size, max notional, orders/min throttle, penny stock rejection
- **Eval pre-filters:** save API costs by rejecting obviously bad setups before calling 3 models
- **Boot reconciliation:** on startup, reconciles local DB with IBKR live state
- **Periodic snapshots:** account + positions captured every 5 min during market hours
