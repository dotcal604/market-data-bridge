# IBKR Market Bridge — API Reference

This document specifies all interfaces exposed by the bridge: **56 MCP tools** and **47 REST endpoints**. Both interfaces expose the same underlying service functions with identical semantics.

---

## Quick Reference

The system provides 56 MCP tools organized into 11 functional categories. Each tool has a corresponding REST endpoint (or multiple endpoints).

### Tool Categories

1. [Market Data & Research](#1-market-data--research) — 14 tools
2. [Account & Positions](#2-account--positions) — 4 tools
3. [Order Management](#3-order-management) — 8 tools
4. [Portfolio Analytics](#4-portfolio-analytics) — 3 tools
5. [Flatten & EOD](#5-flatten--eod) — 2 tools
6. [Collaboration Channel](#6-collaboration-channel) — 4 tools
7. [Risk & Session Management](#7-risk--session-management) — 5 tools
8. [Eval Engine](#8-eval-engine) — 8 tools
9. [Trade Journal](#9-trade-journal) — 2 tools
10. [History & Reconciliation](#10-history--reconciliation) — 2 tools
11. [TraderSync Integration](#11-tradersync-integration) — 3 tools
12. [Contract Details](#12-contract-details) — 1 tool

---

## 1. Market Data & Research

### 1.1 `get_status`

**Purpose:** Get bridge status, market session, and IBKR connection state. **Call this FIRST before any query.**

**MCP Tool:**
```
get_status
Params: (none)
```

**REST Endpoint:**
```
GET /api/status
```

**Response:**
```json
{
  "easternTime": "2026-02-13T14:30:00-05:00",
  "marketSession": "regular",
  "ibkr": {
    "connected": true,
    "host": "127.0.0.1",
    "port": 7497,
    "clientId": 0
  }
}
```

---

### 1.2 `get_quote`

**Purpose:** Get a quote for a stock, ETF, or index. Uses IBKR real-time when connected, falls back to Yahoo Finance.

**MCP Tool:**
```
get_quote
Params:
  symbol: string (required) — Ticker symbol (e.g., AAPL, SPY)
```

**REST Endpoint:**
```
GET /api/quote/:symbol
```

**Response:**
```json
{
  "symbol": "AAPL",
  "bid": 275.50,
  "ask": 275.65,
  "last": 275.60,
  "open": 274.20,
  "high": 276.10,
  "low": 273.80,
  "close": 275.65,
  "volume": 48523100,
  "regularMarketPrice": 275.60,
  "regularMarketChange": 1.40,
  "regularMarketChangePercent": 0.51,
  "source": "ibkr"
}
```

**Notes:**
- Always includes `source` field: `"ibkr"` or `"yahoo"`
- IBKR provides real-time bid/ask when connected
- Yahoo provides delayed quotes with extended market data

---

### 1.3 `get_historical_bars`

**Purpose:** Get historical OHLCV bars for a stock.

**MCP Tool:**
```
get_historical_bars
Params:
  symbol: string (required)
  period: string (optional) — "1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max" (default: "1mo")
  interval: string (optional) — "1m", "5m", "15m", "30m", "1h", "1d", "1wk", "1mo" (default: "1d")
```

**REST Endpoint:**
```
GET /api/history/:symbol?period=1mo&interval=1d
```

**Response:**
```json
{
  "symbol": "AAPL",
  "bars": [
    {
      "time": 1707264000,
      "open": 243.50,
      "high": 245.80,
      "low": 242.10,
      "close": 244.90,
      "volume": 62341000
    }
  ]
}
```

---

### 1.4 `get_stock_details`

**Purpose:** Get detailed company info: sector, industry, description, market cap, PE ratio, 52-week range.

**MCP Tool:**
```
get_stock_details
Params:
  symbol: string (required)
```

**REST Endpoint:**
```
GET /api/details/:symbol
```

**Response:**
```json
{
  "symbol": "AAPL",
  "longName": "Apple Inc.",
  "sector": "Technology",
  "industry": "Consumer Electronics",
  "marketCap": 2800000000000,
  "trailingPE": 28.5,
  "fiftyTwoWeekLow": 164.08,
  "fiftyTwoWeekHigh": 199.62,
  "averageVolume": 54280000,
  "description": "Apple Inc. designs, manufactures, and markets smartphones..."
}
```

---

### 1.5 `get_options_chain`

**Purpose:** Get option expirations, strikes, and full chain data (calls + puts with bid/ask/IV/OI).

**MCP Tool:**
```
get_options_chain
Params:
  symbol: string (required)
```

**REST Endpoint:**
```
GET /api/options/:symbol
```

**Response:**
```json
{
  "symbol": "AAPL",
  "expirations": ["2026-02-20", "2026-02-27", "2026-03-20"],
  "strikes": [250, 255, 260, 265, 270, 275, 280],
  "calls": [
    {
      "strike": 275,
      "expiration": "2026-02-20",
      "bid": 2.50,
      "ask": 2.65,
      "last": 2.58,
      "volume": 4521,
      "openInterest": 12345,
      "impliedVolatility": 0.28
    }
  ],
  "puts": []
}
```

---

### 1.6 `get_option_quote`

**Purpose:** Get quote for a specific option contract.

**MCP Tool:**
```
get_option_quote
Params:
  symbol: string (required)
  expiry: string (required) — Format: YYYYMMDD
  strike: number (required)
  right: string (required) — "C" or "P"
```

**REST Endpoint:**
```
GET /api/options/:symbol/quote?expiry=20260320&strike=220&right=C
```

**Response:**
```json
{
  "symbol": "AAPL",
  "strike": 220,
  "expiry": "20260320",
  "right": "C",
  "bid": 2.50,
  "ask": 2.65,
  "last": 2.58,
  "volume": 4521,
  "openInterest": 12345,
  "impliedVolatility": 0.28
}
```

---

### 1.7 `search_symbols`

**Purpose:** Search for stocks, ETFs, indices by name or partial symbol.

**MCP Tool:**
```
search_symbols
Params:
  query: string (required) — Search term (e.g., "Apple" or "AA")
```

**REST Endpoint:**
```
GET /api/search?q=Apple
```

**Response:**
```json
{
  "quotes": [
    {
      "symbol": "AAPL",
      "shortname": "Apple Inc.",
      "quoteType": "EQUITY",
      "exchange": "NMS"
    }
  ]
}
```

---

### 1.8 `get_news`

**Purpose:** Get recent news articles for a stock ticker or search query.

**MCP Tool:**
```
get_news
Params:
  query: string (required) — Ticker symbol or search term
```

**REST Endpoint:**
```
GET /api/news/:query
```

**Response:**
```json
{
  "articles": [
    {
      "title": "Apple reports record Q4 earnings",
      "publisher": "Reuters",
      "link": "https://...",
      "providerPublishTime": 1707264000
    }
  ]
}
```

---

### 1.9 `get_financials`

**Purpose:** Get financial data: revenue, margins, debt, analyst targets, recommendation.

**MCP Tool:**
```
get_financials
Params:
  symbol: string (required)
```

**REST Endpoint:**
```
GET /api/financials/:symbol
```

**Response:**
```json
{
  "symbol": "AAPL",
  "totalRevenue": 383285000000,
  "grossMargins": 0.44,
  "profitMargins": 0.26,
  "totalDebt": 112000000000,
  "targetHighPrice": 250.0,
  "targetLowPrice": 180.0,
  "targetMeanPrice": 215.0,
  "recommendationKey": "buy"
}
```

---

### 1.10 `get_earnings`

**Purpose:** Get earnings history (actual vs estimate) and annual/quarterly financial charts.

**MCP Tool:**
```
get_earnings
Params:
  symbol: string (required)
```

**REST Endpoint:**
```
GET /api/earnings/:symbol
```

**Response:**
```json
{
  "symbol": "AAPL",
  "earningsChart": {
    "quarterly": [
      {
        "date": "2025-Q4",
        "actual": 2.18,
        "estimate": 2.10
      }
    ]
  }
}
```

---

### 1.11 `get_trending`

**Purpose:** Get currently trending stock symbols.

**MCP Tool:**
```
get_trending
Params: (none)
```

**REST Endpoint:**
```
GET /api/trending
```

**Response:**
```json
{
  "quotes": [
    { "symbol": "TSLA" },
    { "symbol": "NVDA" },
    { "symbol": "AAPL" }
  ]
}
```

---

### 1.12 `get_screener_filters`

**Purpose:** Get available stock screener IDs and their descriptions.

**MCP Tool:**
```
get_screener_filters
Params: (none)
```

**REST Endpoint:**
```
GET /api/screener/filters
```

**Response:**
```json
{
  "screeners": [
    { "id": "day_gainers", "description": "Top gaining stocks today" },
    { "id": "day_losers", "description": "Top losing stocks today" },
    { "id": "most_actives", "description": "Most actively traded stocks" }
  ]
}
```

---

### 1.13 `run_screener`

**Purpose:** Run a stock screener. Returns ranked list of stocks matching criteria.

**MCP Tool:**
```
run_screener
Params:
  scrIds: string (required) — Screener ID (e.g., "day_gainers")
  count: number (optional) — Max results (default: 25)
```

**REST Endpoint:**
```
POST /api/screener/run
Body: { "scrIds": "day_gainers", "count": 25 }
```

**Response:**
```json
{
  "quotes": [
    {
      "symbol": "XYZ",
      "regularMarketPrice": 45.20,
      "regularMarketChange": 5.30,
      "regularMarketChangePercent": 13.28,
      "regularMarketVolume": 12450000
    }
  ]
}
```

---

### 1.14 `run_screener_with_quotes`

**Purpose:** Run a stock screener with full quote data (bid/ask/OHLC/sector/industry/PE). More detail than `run_screener`.

**MCP Tool:**
```
run_screener_with_quotes
Params:
  scrIds: string (required)
  count: number (optional) — Max results (default: 25)
```

**REST Endpoint:**
```
POST /api/screener/run-with-quotes
Body: { "scrIds": "day_gainers", "count": 25 }
```

**Response:** Same as `run_screener` but with additional fields: `bid`, `ask`, `open`, `high`, `low`, `close`, `sector`, `industry`, `marketCap`, `trailingPE`, `averageVolume`.

---

## 2. Account & Positions

### 2.1 `get_account_summary`

**Purpose:** Get IBKR account summary: net liquidation, cash, buying power, margin. Requires TWS/Gateway.

**MCP Tool:**
```
get_account_summary
Params: (none)
```

**REST Endpoint:**
```
GET /api/account/summary
```

**Response:**
```json
{
  "NetLiquidation": 125430.50,
  "AvailableFunds": 62715.25,
  "BuyingPower": 250860.00,
  "TotalCashValue": 25086.10,
  "GrossPositionValue": 100344.40,
  "InitMarginReq": 25086.10,
  "MaintMarginReq": 12543.05
}
```

---

### 2.2 `get_positions`

**Purpose:** Get all current IBKR positions with symbol, quantity, and average cost. Requires TWS/Gateway.

**MCP Tool:**
```
get_positions
Params: (none)
```

**REST Endpoint:**
```
GET /api/account/positions
```

**Response:**
```json
{
  "positions": [
    {
      "symbol": "AAPL",
      "position": 100,
      "avgCost": 150.25,
      "marketPrice": 175.60,
      "marketValue": 17560.00,
      "unrealizedPnL": 2535.00
    }
  ]
}
```

---

### 2.3 `get_pnl`

**Purpose:** Get daily profit and loss (daily PnL, unrealized PnL, realized PnL). Requires TWS/Gateway.

**MCP Tool:**
```
get_pnl
Params: (none)
```

**REST Endpoint:**
```
GET /api/account/pnl
```

**Response:**
```json
{
  "dailyPnL": 1250.75,
  "unrealizedPnL": 2535.00,
  "realizedPnL": -284.25
}
```

---

### 2.4 `get_ibkr_quote`

**Purpose:** Get a real-time quote snapshot directly from IBKR TWS (bid, ask, last, OHLC, volume). Requires market data subscription.

**MCP Tool:**
```
get_ibkr_quote
Params:
  symbol: string (required)
```

**REST Endpoint:**
```
GET /api/ibkr/quote/:symbol
```

**Response:**
```json
{
  "symbol": "AAPL",
  "bid": 275.50,
  "ask": 275.65,
  "last": 275.60,
  "open": 274.20,
  "high": 276.10,
  "low": 273.80,
  "close": 275.65,
  "volume": 48523100
}
```

---

## 3. Order Management

### 3.1 `get_open_orders`

**Purpose:** Get all open orders across all clients. Shows orderId, symbol, action, type, quantity, limit/stop price, status, TIF.

**MCP Tool:**
```
get_open_orders
Params: (none)
```

**REST Endpoint:**
```
GET /api/account/orders
```

**Response:**
```json
{
  "orders": [
    {
      "orderId": 123,
      "symbol": "AAPL",
      "action": "BUY",
      "orderType": "LMT",
      "totalQuantity": 100,
      "lmtPrice": 270.00,
      "status": "PreSubmitted",
      "tif": "DAY"
    }
  ]
}
```

---

### 3.2 `get_completed_orders`

**Purpose:** Get completed (filled/cancelled) orders. Shows fill price, quantity, status, completion time.

**MCP Tool:**
```
get_completed_orders
Params: (none)
```

**REST Endpoint:**
```
GET /api/account/orders/completed
```

**Response:**
```json
{
  "orders": [
    {
      "orderId": 122,
      "symbol": "AAPL",
      "action": "BUY",
      "orderType": "MKT",
      "totalQuantity": 100,
      "avgFillPrice": 274.80,
      "status": "Filled",
      "filledTime": "2026-02-13T09:35:00Z"
    }
  ]
}
```

---

### 3.3 `get_executions`

**Purpose:** Get today's executions/fills with commission and realized P&L. Optionally filter by symbol, secType, or time.

**MCP Tool:**
```
get_executions
Params:
  symbol: string (optional)
  secType: string (optional)
  time: string (optional) — Format: YYYYMMDD-HH:MM:SS
```

**REST Endpoint:**
```
GET /api/account/executions?symbol=AAPL
```

**Response:**
```json
{
  "executions": [
    {
      "execId": "0000e0d5.65e3a4c2.01.01",
      "orderId": 122,
      "symbol": "AAPL",
      "side": "BOT",
      "shares": 100,
      "price": 274.80,
      "time": "2026-02-13T09:35:12Z",
      "commission": 1.00,
      "realizedPnL": 0
    }
  ]
}
```

---

### 3.4 `place_order`

**Purpose:** Place a single order on IBKR. Supports all order types: MKT, LMT, STP, STP LMT, TRAIL, TRAIL LIMIT, REL, MIT, MOC, LOC, PEG MID. Requires TWS/Gateway.

**MCP Tool:**
```
place_order
Params:
  symbol: string (required)
  action: string (required) — "BUY" or "SELL"
  quantity: number (required)
  orderType: string (required) — "MKT", "LMT", "STP", "STP LMT", "TRAIL", "TRAIL LIMIT", etc.
  lmtPrice: number (optional) — Required for LMT, STP LMT, TRAIL LIMIT
  auxPrice: number (optional) — Required for STP, STP LMT (stop price)
  trailingPercent: number (optional) — For TRAIL, TRAIL LIMIT
  tif: string (optional) — "DAY", "GTC", "IOC", "GTD" (default: "DAY")
```

**REST Endpoint:**
```
POST /api/order
Body: {
  "symbol": "AAPL",
  "action": "BUY",
  "quantity": 100,
  "orderType": "LMT",
  "lmtPrice": 270.00,
  "tif": "DAY"
}
```

**Response:**
```json
{
  "orderId": 123,
  "status": "PreSubmitted"
}
```

---

### 3.5 `place_bracket_order`

**Purpose:** Place a bracket order (entry + take profit + stop loss) on IBKR. Requires TWS/Gateway.

**MCP Tool:**
```
place_bracket_order
Params:
  symbol: string (required)
  action: string (required) — "BUY" or "SELL"
  quantity: number (required)
  entryPrice: number (required)
  takeProfitPrice: number (required)
  stopLossPrice: number (required)
```

**REST Endpoint:**
```
POST /api/order/bracket
Body: {
  "symbol": "AAPL",
  "action": "BUY",
  "quantity": 100,
  "entryPrice": 270.00,
  "takeProfitPrice": 280.00,
  "stopLossPrice": 265.00
}
```

**Response:**
```json
{
  "parentOrderId": 123,
  "takeProfitOrderId": 124,
  "stopLossOrderId": 125
}
```

---

### 3.6 `place_advanced_bracket`

**Purpose:** Place an advanced bracket order with OCA group, trailing stop support, and any order types. Entry + Take Profit + Stop Loss (STP, TRAIL, TRAIL LIMIT, STP LMT). Requires TWS/Gateway.

**MCP Tool:**
```
place_advanced_bracket
Params:
  symbol: string (required)
  action: string (required)
  quantity: number (required)
  entryOrderType: string (required) — "MKT", "LMT", "STP", "STP LMT"
  entryLmtPrice: number (optional)
  entryAuxPrice: number (optional)
  takeProfitPrice: number (required)
  stopLossOrderType: string (required) — "STP", "TRAIL", "TRAIL LIMIT", "STP LMT"
  stopLossAuxPrice: number (optional)
  trailingPercent: number (optional)
  useAdaptive: boolean (optional) — Use IBKR adaptive algo (default: false)
```

**REST Endpoint:**
```
POST /api/order/bracket-advanced
Body: {
  "symbol": "AAPL",
  "action": "BUY",
  "quantity": 100,
  "entryOrderType": "LMT",
  "entryLmtPrice": 270.00,
  "takeProfitPrice": 280.00,
  "stopLossOrderType": "TRAIL",
  "trailingPercent": 2.0,
  "useAdaptive": true
}
```

**Response:**
```json
{
  "parentOrderId": 123,
  "takeProfitOrderId": 124,
  "stopLossOrderId": 125
}
```

---

### 3.7 `cancel_order`

**Purpose:** Cancel a specific open order by orderId. Requires TWS/Gateway.

**MCP Tool:**
```
cancel_order
Params:
  orderId: number (required)
```

**REST Endpoint:**
```
DELETE /api/order/:orderId
```

**Response:**
```json
{
  "success": true,
  "orderId": 123
}
```

---

### 3.8 `cancel_all_orders`

**Purpose:** Cancel ALL open orders globally. Use with caution. Requires TWS/Gateway.

**MCP Tool:**
```
cancel_all_orders
Params: (none)
```

**REST Endpoint:**
```
DELETE /api/orders/all
```

**Response:**
```json
{
  "success": true,
  "message": "All orders cancelled"
}
```

---

## 4. Portfolio Analytics

### 4.1 `portfolio_exposure`

**Purpose:** Compute portfolio exposure analytics: gross/net exposure, % deployed, largest position, sector breakdown, beta-weighted exposure, portfolio heat. Requires TWS/Gateway.

**MCP Tool:**
```
portfolio_exposure
Params: (none)
```

**REST Endpoint:**
```
GET /api/portfolio/exposure
```

**Response:**
```json
{
  "grossExposure": 125430.50,
  "netExposure": 75258.30,
  "netLiquidation": 150516.60,
  "percentDeployed": 83.32,
  "largestPosition": {
    "symbol": "AAPL",
    "marketValue": 35120.80,
    "percentOfPortfolio": 23.32
  },
  "sectors": [
    { "sector": "Technology", "exposure": 65280.40, "percent": 43.36 }
  ],
  "betaWeightedExposure": 82351.20,
  "portfolioHeat": 4250.75
}
```

---

### 4.2 `stress_test`

**Purpose:** Run a portfolio stress test using open positions and account net liquidation. Supports optional beta-adjusted shocks.

**MCP Tool:**
```
stress_test
Params:
  shockPercent: number (optional) — Shock percentage (default: -10.0)
  useBeta: boolean (optional) — Apply beta adjustment (default: true)
```

**REST Endpoint:**
```
POST /api/portfolio/stress-test
Body: { "shockPercent": -10.0, "useBeta": true }
```

**Response:**
```json
{
  "currentValue": 150516.60,
  "stressedValue": 135464.94,
  "potentialLoss": -15051.66,
  "percentLoss": -10.0,
  "positions": [
    {
      "symbol": "AAPL",
      "currentValue": 35120.80,
      "stressedValue": 31608.72,
      "loss": -3512.08,
      "beta": 1.2
    }
  ]
}
```

---

### 4.3 `size_position`

**Purpose:** Calculate safe position size based on account equity, risk parameters, and margin capacity. Read-only computation — does not place orders.

**MCP Tool:**
```
size_position
Params:
  accountEquity: number (required)
  entryPrice: number (required)
  stopPrice: number (required)
  riskPerTrade: number (optional) — Risk % per trade (default: 1.0)
  maxCapitalPerTrade: number (optional) — Max % of capital per trade (default: 10.0)
  marginRequirement: number (optional) — Initial margin % (default: 25.0)
```

**REST Endpoint:**
```
POST /api/risk/size-position
Body: {
  "accountEquity": 100000,
  "entryPrice": 150.00,
  "stopPrice": 145.00,
  "riskPerTrade": 1.0,
  "maxCapitalPerTrade": 10.0
}
```

**Response:**
```json
{
  "recommendedShares": 200,
  "byRisk": 200,
  "byCapital": 66,
  "byMargin": 266,
  "riskAmount": 1000.00,
  "notionalValue": 30000.00,
  "marginRequired": 7500.00,
  "warnings": []
}
```

---

## 5. Flatten & EOD

### 5.1 `flatten_positions`

**Purpose:** Immediately close ALL open positions with MKT orders and cancel all open orders. Use for EOD flatten or emergency exit.

**MCP Tool:**
```
flatten_positions
Params: (none)
```

**REST Endpoint:**
```
POST /api/positions/flatten
```

**Response:**
```json
{
  "flattened": [
    { "symbol": "AAPL", "quantity": 100, "orderId": 126 }
  ],
  "skipped": [],
  "cancelledOrders": 2
}
```

---

### 5.2 `flatten_config`

**Purpose:** Get or set the EOD auto-flatten configuration. Returns current time/enabled state. Pass enabled=true/false to toggle.

**MCP Tool:**
```
flatten_config
Params:
  enabled: boolean (optional) — Enable/disable auto-flatten
  time: string (optional) — Time in ET 24h format (e.g., "15:55")
```

**REST Endpoint:**
```
GET /api/flatten/config
POST /api/flatten/enable
Body: { "enabled": true }
```

**Response:**
```json
{
  "enabled": true,
  "time": "15:55",
  "firedToday": false
}
```

---

## 6. Collaboration Channel

### 6.1 `collab_read`

**Purpose:** Read messages from the AI collaboration channel. Use this to see what ChatGPT or the user has posted.

**MCP Tool:**
```
collab_read
Params:
  limit: number (optional) — Max messages to return (default: 10)
```

**REST Endpoint:**
```
GET /api/collab/messages?limit=10
```

**Response:**
```json
{
  "messages": [
    {
      "id": 1,
      "timestamp": "2026-02-13T14:30:00Z",
      "author": "chatgpt",
      "content": "I've identified 3 high-probability setups..."
    }
  ]
}
```

---

### 6.2 `collab_post`

**Purpose:** Post a message to the AI collaboration channel. Use this to share analysis, code suggestions, or responses to ChatGPT. Your author is always 'claude'.

**MCP Tool:**
```
collab_post
Params:
  content: string (required) — Message content
```

**REST Endpoint:**
```
POST /api/collab/message
Body: { "content": "Analysis complete. Key findings: ..." }
```

**Response:**
```json
{
  "id": 2,
  "timestamp": "2026-02-13T14:31:00Z",
  "author": "claude",
  "content": "Analysis complete. Key findings: ..."
}
```

---

### 6.3 `collab_clear`

**Purpose:** Clear all messages from the AI collaboration channel. Use when starting a new topic or conversation.

**MCP Tool:**
```
collab_clear
Params: (none)
```

**REST Endpoint:**
```
DELETE /api/collab/messages
```

**Response:**
```json
{
  "cleared": 5
}
```

---

### 6.4 `collab_stats`

**Purpose:** Get statistics for the AI collaboration channel — total messages and count by author.

**MCP Tool:**
```
collab_stats
Params: (none)
```

**REST Endpoint:**
```
GET /api/collab/stats
```

**Response:**
```json
{
  "total": 15,
  "byAuthor": {
    "claude": 8,
    "chatgpt": 5,
    "user": 2
  }
}
```

---

## 7. Risk & Session Management

### 7.1 `session_state`

**Purpose:** Get current trading session state: daily P&L, trade count, consecutive losses, cooldown status, and all session limits.

**MCP Tool:**
```
session_state
Params: (none)
```

**REST Endpoint:**
```
GET /api/session
```

**Response:**
```json
{
  "dailyPnL": 1250.75,
  "tradeCount": 5,
  "winCount": 3,
  "lossCount": 2,
  "consecutiveLosses": 1,
  "inCooldown": false,
  "locked": false,
  "limits": {
    "maxDailyLoss": 2000.00,
    "maxConsecutiveLosses": 3,
    "maxTradesPerDay": 10
  }
}
```

---

### 7.2 `session_record_trade`

**Purpose:** Record a completed trade result to update session guardrails. Feed this after every trade closes.

**MCP Tool:**
```
session_record_trade
Params:
  pnl: number (required) — Trade P&L
  symbol: string (optional)
  notes: string (optional)
```

**REST Endpoint:**
```
POST /api/session/trade
Body: { "pnl": 125.50, "symbol": "AAPL", "notes": "Gap and go" }
```

**Response:**
```json
{
  "dailyPnL": 1376.25,
  "tradeCount": 6,
  "consecutiveLosses": 0
}
```

---

### 7.3 `session_lock`

**Purpose:** Manually lock the session to prevent any new trades. Use when tilting or stepping away.

**MCP Tool:**
```
session_lock
Params: (none)
```

**REST Endpoint:**
```
POST /api/session/lock
```

**Response:**
```json
{
  "locked": true
}
```

---

### 7.4 `session_unlock`

**Purpose:** Unlock a manually locked session to resume trading.

**MCP Tool:**
```
session_unlock
Params: (none)
```

**REST Endpoint:**
```
POST /api/session/unlock
```

**Response:**
```json
{
  "locked": false
}
```

---

### 7.5 `session_reset`

**Purpose:** Reset session state. Use at start of day or after a break to clear all counters.

**MCP Tool:**
```
session_reset
Params: (none)
```

**REST Endpoint:**
```
POST /api/session/reset
```

**Response:**
```json
{
  "dailyPnL": 0,
  "tradeCount": 0,
  "consecutiveLosses": 0
}
```

---

## 8. Eval Engine

### 8.1 `eval_stats`

**Purpose:** Get model performance statistics — total evaluations, average scores, win rate, model accuracy. Includes per-model breakdown.

**MCP Tool:**
```
eval_stats
Params: (none)
```

**REST Endpoint:**
```
GET /api/eval/stats
```

**Response:**
```json
{
  "totalEvaluations": 156,
  "avgEnsembleScore": 6.82,
  "winRate": 0.58,
  "models": {
    "claude-sonnet": { "avgScore": 7.1, "accuracy": 0.62 },
    "gpt-4o": { "avgScore": 6.8, "accuracy": 0.55 },
    "gemini-flash": { "avgScore": 6.5, "accuracy": 0.57 }
  }
}
```

---

### 8.2 `simulate_weights`

**Purpose:** Re-score historical evaluations with custom weights. Shows comparison: current vs simulated avg score, trade rate, accuracy. Use to answer "what if I weighted claude higher?" before committing.

**MCP Tool:**
```
simulate_weights
Params:
  claudeWeight: number (required)
  gptWeight: number (required)
  geminiWeight: number (required)
```

**REST Endpoint:**
```
POST /api/eval/weights/simulate
Body: { "claudeWeight": 0.5, "gptWeight": 0.3, "geminiWeight": 0.2 }
```

**Response:**
```json
{
  "current": {
    "avgScore": 6.82,
    "tradeRate": 0.45,
    "winRate": 0.58
  },
  "simulated": {
    "avgScore": 7.05,
    "tradeRate": 0.52,
    "winRate": 0.61
  }
}
```

---

### 8.3 `weight_history`

**Purpose:** Get history of ensemble weight changes. Shows timestamp, weights, sample size, and reason (manual/recalibration/simulation) for each update.

**MCP Tool:**
```
weight_history
Params:
  limit: number (optional) — Max records to return (default: 10)
```

**REST Endpoint:**
```
GET /api/eval/weights/history?limit=10
```

**Response:**
```json
{
  "history": [
    {
      "timestamp": "2026-02-10T10:00:00Z",
      "claudeWeight": 0.4,
      "gptWeight": 0.35,
      "geminiWeight": 0.25,
      "sampleSize": 150,
      "reason": "Recalibration after 50+ outcomes"
    }
  ]
}
```

---

### 8.4 `eval_outcomes`

**Purpose:** Get evaluations joined with their trade outcomes. Core data for calibration curves, regime analysis, and scatter plots.

**MCP Tool:**
```
eval_outcomes
Params:
  limit: number (optional) — Max records (default: 100)
  minScore: number (optional) — Filter by ensemble score >= value
```

**REST Endpoint:**
```
GET /api/eval/outcomes?limit=100&minScore=6.0
```

**Response:**
```json
{
  "outcomes": [
    {
      "evalId": "abc123",
      "symbol": "AAPL",
      "direction": "long",
      "ensembleScore": 7.5,
      "rMultiple": 2.3,
      "outcome": "WIN",
      "timestamp": "2026-02-13T09:30:00Z"
    }
  ]
}
```

---

### 8.5 `record_outcome`

**Purpose:** Record a trade outcome for an evaluation. Tag behavioral fields (confidence, rule_followed, setup_type) alongside the outcome for edge analytics.

**MCP Tool:**
```
record_outcome
Params:
  evalId: string (required)
  outcome: string (required) — "WIN", "LOSS", "BREAKEVEN"
  rMultiple: number (required)
  entryPrice: number (required)
  exitPrice: number (required)
  entryTime: string (optional)
  exitTime: string (optional)
  notes: string (optional)
```

**REST Endpoint:**
```
POST /api/eval/outcome
Body: {
  "evalId": "abc123",
  "outcome": "WIN",
  "rMultiple": 2.3,
  "entryPrice": 150.00,
  "exitPrice": 161.50,
  "notes": "Clean breakout"
}
```

**Response:**
```json
{
  "success": true,
  "evalId": "abc123",
  "outcome": "WIN",
  "rMultiple": 2.3
}
```

---

### 8.6 `eval_reasoning`

**Purpose:** Get structured reasoning for an evaluation. Returns per-model key_drivers (which features drove the decision), risk_factors, uncertainties, and conviction level.

**MCP Tool:**
```
eval_reasoning
Params:
  evalId: string (required)
```

**REST Endpoint:**
```
GET /api/eval/:id/reasoning
```

**Response:**
```json
{
  "evalId": "abc123",
  "models": {
    "claude-sonnet": {
      "keyDrivers": ["Strong volume surge", "VWAP reclaim"],
      "riskFactors": ["Wide spread", "Low float"],
      "uncertainties": ["Sector rotation risk"],
      "conviction": 8
    }
  }
}
```

---

### 8.7 `drift_report`

**Purpose:** Generate model calibration drift report. Compares per-model confidence buckets (0-25, 25-50, 50-75, 75-100) against actual win rates. Flags models where any bucket deviates >15% from expected.

**MCP Tool:**
```
drift_report
Params: (none)
```

**REST Endpoint:**
```
GET /api/eval/drift-report
```

**Response:**
```json
{
  "models": {
    "claude-sonnet": {
      "calibrated": true,
      "buckets": [
        { "range": "75-100", "expectedWin": 0.875, "actualWin": 0.82, "deviation": -0.055 }
      ]
    }
  }
}
```

---

### 8.8 `daily_summary`

**Purpose:** Get daily session summaries — P&L, win rate, avg R, best/worst R per day. Query params: date (single day) or days (last N days).

**MCP Tool:**
```
daily_summary
Params:
  date: string (optional) — Single day (YYYY-MM-DD)
  days: number (optional) — Last N days (default: 7)
```

**REST Endpoint:**
```
GET /api/eval/daily-summary?days=7
```

**Response:**
```json
{
  "sessions": [
    {
      "date": "2026-02-13",
      "pnl": 1250.75,
      "tradeCount": 5,
      "winRate": 0.60,
      "avgR": 1.8,
      "bestR": 3.2,
      "worstR": -1.0
    }
  ],
  "totals": {
    "pnl": 5432.10,
    "tradeCount": 28,
    "winRate": 0.57,
    "avgR": 1.6
  }
}
```

---

## 9. Trade Journal

### 9.1 `trade_journal_read`

**Purpose:** Query trade journal entries. Filter by symbol or strategy.

**MCP Tool:**
```
trade_journal_read
Params:
  symbol: string (optional)
  strategy: string (optional)
  limit: number (optional) — Max records (default: 20)
```

**REST Endpoint:**
```
GET /api/journal?symbol=AAPL&limit=20
```

**Response:**
```json
{
  "entries": [
    {
      "id": "journal123",
      "symbol": "AAPL",
      "strategy": "gap_and_go",
      "reasoning": "Clean gap with volume, SPY bullish",
      "outcome": "WIN",
      "rMultiple": 2.3,
      "tags": ["momentum", "premarket"],
      "timestamp": "2026-02-13T09:30:00Z"
    }
  ]
}
```

---

### 9.2 `trade_journal_write`

**Purpose:** Add or update a trade journal entry. To create, provide 'reasoning'. To update, provide 'id' with outcome_tags/notes.

**MCP Tool:**
```
trade_journal_write
Params:
  id: string (optional) — For updates
  symbol: string (required for new)
  strategy: string (optional)
  reasoning: string (required for new)
  outcome: string (optional)
  rMultiple: number (optional)
  tags: array (optional)
  notes: string (optional)
```

**REST Endpoint:**
```
POST /api/journal
Body: {
  "symbol": "AAPL",
  "strategy": "gap_and_go",
  "reasoning": "Clean gap with volume, SPY bullish",
  "tags": ["momentum", "premarket"]
}
```

**Response:**
```json
{
  "id": "journal123",
  "symbol": "AAPL",
  "timestamp": "2026-02-13T09:30:00Z"
}
```

---

## 10. History & Reconciliation

### 10.1 `orders_history`

**Purpose:** Query historical orders from the local database. Filter by symbol or strategy.

**MCP Tool:**
```
orders_history
Params:
  symbol: string (optional)
  strategy: string (optional)
  limit: number (optional) — Max records (default: 50)
```

**REST Endpoint:**
```
GET /api/orders/history?symbol=AAPL&limit=50
```

**Response:**
```json
{
  "orders": [
    {
      "orderId": 122,
      "symbol": "AAPL",
      "action": "BUY",
      "orderType": "LMT",
      "quantity": 100,
      "lmtPrice": 270.00,
      "status": "Filled",
      "timestamp": "2026-02-13T09:35:00Z"
    }
  ]
}
```

---

### 10.2 `executions_history`

**Purpose:** Query historical executions from the local database. Filter by symbol.

**MCP Tool:**
```
executions_history
Params:
  symbol: string (optional)
  limit: number (optional) — Max records (default: 50)
```

**REST Endpoint:**
```
GET /api/executions/history?symbol=AAPL&limit=50
```

**Response:**
```json
{
  "executions": [
    {
      "execId": "0000e0d5.65e3a4c2.01.01",
      "orderId": 122,
      "symbol": "AAPL",
      "side": "BOT",
      "shares": 100,
      "price": 274.80,
      "commission": 1.00,
      "timestamp": "2026-02-13T09:35:12Z"
    }
  ]
}
```

---

## 11. TraderSync Integration

### 11.1 `tradersync_import`

**Purpose:** Import TraderSync trade_data CSV content into the database. Pass the full CSV content as a string.

**MCP Tool:**
```
tradersync_import
Params:
  csvContent: string (required) — Full CSV file content
```

**REST Endpoint:**
```
POST /api/eval/tradersync/import
Body: { "csvContent": "Date,Symbol,Side,Qty,Entry,Exit,PnL\n..." }
```

**Response:**
```json
{
  "batchId": "batch123",
  "inserted": 45,
  "skipped": 2,
  "errors": []
}
```

---

### 11.2 `tradersync_stats`

**Purpose:** Get aggregate stats from imported TraderSync trades: total trades, win rate, avg R, total P&L, unique symbols, date range.

**MCP Tool:**
```
tradersync_stats
Params: (none)
```

**REST Endpoint:**
```
GET /api/eval/tradersync/stats
```

**Response:**
```json
{
  "totalTrades": 45,
  "winRate": 0.62,
  "avgR": 1.8,
  "totalPnL": 5432.10,
  "uniqueSymbols": 18,
  "dateRange": {
    "start": "2025-12-01",
    "end": "2026-02-13"
  }
}
```

---

### 11.3 `tradersync_trades`

**Purpose:** Query imported TraderSync trades. Filter by symbol, side (LONG/SHORT), status (WIN/LOSS), and lookback days.

**MCP Tool:**
```
tradersync_trades
Params:
  symbol: string (optional)
  side: string (optional) — "LONG" or "SHORT"
  status: string (optional) — "WIN" or "LOSS"
  days: number (optional) — Lookback days (default: 30)
  limit: number (optional) — Max records (default: 50)
```

**REST Endpoint:**
```
GET /api/eval/tradersync/trades?symbol=AAPL&side=LONG&limit=50
```

**Response:**
```json
{
  "trades": [
    {
      "id": "ts123",
      "date": "2026-02-13",
      "symbol": "AAPL",
      "side": "LONG",
      "quantity": 100,
      "entryPrice": 150.00,
      "exitPrice": 161.50,
      "pnl": 1150.00,
      "rMultiple": 2.3,
      "status": "WIN"
    }
  ]
}
```

---

## 12. Contract Details

### 12.1 `get_contract_details`

**Purpose:** Get IBKR contract details: trading hours, valid exchanges, min tick, multiplier, industry classification.

**MCP Tool:**
```
get_contract_details
Params:
  symbol: string (required)
```

**REST Endpoint:**
```
GET /api/contract/:symbol
```

**Response:**
```json
{
  "symbol": "AAPL",
  "conId": 265598,
  "exchange": "SMART",
  "primaryExch": "NASDAQ",
  "currency": "USD",
  "longName": "APPLE INC",
  "industry": "Computer Hardware",
  "category": "Computers",
  "subcategory": "Computers",
  "tradingHours": "20260213:0930-20260213:1600",
  "liquidHours": "20260213:0930-20260213:1600",
  "timeZoneId": "US/Eastern",
  "minTick": 0.01,
  "validExchanges": "SMART,NASDAQ,NYSE,BATS"
}
```

---

## REST API Authentication

All REST endpoints require authentication via API key (except `/api/status` and `/openapi.json`).

**Methods:**
1. `X-API-Key` header
2. `Authorization: Bearer {key}` header
3. `apiKey` query parameter

**Example:**
```bash
curl -H "X-API-Key: your-api-key" http://localhost:3000/api/quote/AAPL
```

Configure API key in `.env`:
```
API_KEY=your-secret-key-here
```

---

## Rate Limits

| Endpoint Category | Limit | Window |
|------------------|-------|--------|
| Global | 100 requests | 1 minute |
| Orders (`/api/order`, `/api/positions/flatten`) | 10 requests | 1 minute |
| Eval (`/api/eval/evaluate`) | 10 requests | 1 minute |
| Collaboration (`/api/collab/*`) | 30 requests | 1 minute |

Rate limits are keyed by API key, not IP address.

---

## Error Responses

All endpoints return consistent error format:

```json
{
  "error": "Error message describing what went wrong"
}
```

**Common HTTP status codes:**
- `400` — Bad request (invalid parameters)
- `401` — Unauthorized (missing/invalid API key)
- `404` — Not found
- `429` — Rate limit exceeded
- `500` — Internal server error
- `503` — Service unavailable (IBKR disconnected)

---

## WebSocket Real-Time Updates

The system provides WebSocket support for real-time updates on port 3000 (same as REST API).

**Connection:**
```javascript
const ws = new WebSocket('ws://localhost:3000');
```

**Authentication:**
- Via `X-API-Key` header
- Via `Authorization: Bearer {key}` header
- Via `?apiKey={key}` query parameter

**Channels:**
- `positions` — Position updates
- `orders` — Order status changes
- `account` — Account balance updates
- `executions` — New executions

**Subscribe:**
```javascript
ws.send(JSON.stringify({ action: 'subscribe', channel: 'positions' }));
```

**Message format:**
```json
{
  "channel": "positions",
  "data": {
    "symbol": "AAPL",
    "position": 100,
    "avgCost": 150.25,
    "marketValue": 17560.00
  }
}
```

---

## MCP Server Configuration

The MCP server runs on stdio transport and is designed for Claude Desktop/Code integration.

**Claude Desktop config** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "ibkr": {
      "command": "node",
      "args": ["/path/to/market-data-bridge/build/index.js", "--mode", "mcp"]
    }
  }
}
```

**Claude Code config** (`.mcp.json`):
```json
{
  "mcpServers": {
    "ibkr": {
      "command": "node",
      "args": ["./build/index.js", "--mode", "mcp"]
    }
  }
}
```

---

## Complete Tool Summary

| Category | Tool Count | Description |
|----------|-----------|-------------|
| Market Data & Research | 14 | Quotes, historical data, options, screeners, news, financials |
| Account & Positions | 4 | Account summary, positions, P&L, IBKR quotes |
| Order Management | 8 | Place, cancel, query orders and executions |
| Portfolio Analytics | 3 | Exposure analysis, stress testing, position sizing |
| Flatten & EOD | 2 | Flatten positions, configure auto-flatten |
| Collaboration Channel | 4 | AI-to-AI messaging |
| Risk & Session Management | 5 | Session state, trade recording, locks, resets |
| Eval Engine | 8 | Model performance, weight management, drift detection |
| Trade Journal | 2 | Journal entries with tags and outcomes |
| History & Reconciliation | 2 | Historical orders and executions |
| TraderSync Integration | 3 | Import and query TraderSync data |
| Contract Details | 1 | IBKR contract metadata |
| **Total** | **56** | |

