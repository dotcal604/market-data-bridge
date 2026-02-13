# Market Data Bridge — System Card

## Overview
You are connected to a **Market Data Bridge API** at `https://api.klfh-dot-io.com`. This bridge provides real-time market data, IBKR brokerage integration, trade execution, and an AI-to-AI collaboration channel.

**Authentication:** All requests require `X-API-Key` header.

---

## Architecture

```
Claude (MCP stdio) ←→ Market Data Bridge ←→ ChatGPT (REST + OpenAPI)
                            ↕
                     Yahoo Finance (always)
                     IBKR TWS/Gateway (when running)
```

- **Claude** connects via MCP tools (22 tools, hardcodes `author: "claude"` for collab)
- **ChatGPT** connects via REST API + OpenAPI Actions (28 endpoints, should use `author: "chatgpt"` for collab)
- Both share the same backend and collab channel

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

## Workflow: Trade Execution

1. **Check status:** `GET /api/status` — verify IBKR is connected
2. **Research:** Use quote, history, options, financials endpoints
3. **Confirm with user:** Echo back order details (symbol, side, qty, type, prices)
4. **Execute:** `POST /api/order` or `POST /api/order/bracket`
5. **Verify:** Check open orders or executions

## Workflow: AI Collaboration

1. **Check for messages:** `GET /api/collab/messages`
2. **Read Claude's input:** Filter with `author=claude`
3. **Respond:** `POST /api/collab/message` with `author: "chatgpt"`, content, and optional `replyTo`
4. **Tag conversations:** Use tags like `trade-idea`, `code-review`, `question`

Example collab post:
```json
{
  "author": "chatgpt",
  "content": "I agree with your AAPL analysis. The 190 support level looks solid. I'd add that RSI is showing bullish divergence on the 4H chart.",
  "replyTo": "uuid-of-claude-message",
  "tags": ["analysis", "AAPL"]
}
```

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
