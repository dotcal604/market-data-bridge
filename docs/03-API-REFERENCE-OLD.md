# IBKR Market Bridge — API Reference

This document specifies all interfaces exposed by the bridge: 10 MCP tools and 10 REST endpoints. Both interfaces expose the same underlying service functions with identical semantics.

---

## Interface Mapping

| # | MCP Tool Name | REST Endpoint | HTTP | Description |
|---|---|---|---|---|
| 1 | `connection_status` | `/api/status` | GET | Connection health check |
| 2 | `get_quote` | `/api/quote/{symbol}` | GET | Real-time snapshot quote |
| 3 | `get_historical_bars` | `/api/history/{symbol}` | GET | Historical OHLCV bars |
| 4 | `get_contract_details` | `/api/contract/{symbol}` | GET | Contract metadata |
| 5 | `get_options_chain` | `/api/options/{symbol}` | GET | Options expirations and strikes |
| 6 | `get_option_quote` | `/api/options/{symbol}/quote` | GET | Option contract quote |
| 7 | `get_account_summary` | `/api/account/summary` | GET | Account balances and margin |
| 8 | `get_positions` | `/api/account/positions` | GET | Current portfolio positions |
| 9 | `get_pnl` | `/api/account/pnl` | GET | Daily profit and loss |
| 10 | `search_contracts` | `/api/search?q={query}` | GET | Symbol/name search |

---

## 1. Connection Status

**Purpose:** Verify the bridge is connected to TWS/Gateway.

### MCP Tool

```
Tool:   connection_status
Params: (none)
```

### REST Endpoint

```
GET /api/status
```

### Response Schema

```json
{
  "connected": true,
  "host": "127.0.0.1",
  "port": 7496,
  "clientId": 0
}
```

| Field | Type | Description |
|---|---|---|
| `connected` | `boolean` | `true` if TCP socket to TWS is established |
| `host` | `string` | Configured TWS host address |
| `port` | `integer` | Configured TWS port |
| `clientId` | `integer` | API client ID in use |

---

## 2. Get Quote

**Purpose:** Retrieve a real-time snapshot quote for a stock, ETF, or index.

### MCP Tool

```
Tool:   get_quote
Params:
  symbol:    string  (required)  — Ticker symbol, e.g. "AAPL"
  sec_type:  string  (optional)  — Security type: STK (default), ETF, IND
  exchange:  string  (optional)  — Exchange, default "SMART"
  currency:  string  (optional)  — Currency, default "USD"
```

### REST Endpoint

```
GET /api/quote/{symbol}?sec_type=STK&exchange=SMART&currency=USD
```

| Parameter | In | Type | Required | Default | Description |
|---|---|---|---|---|---|
| `symbol` | path | string | yes | — | Ticker symbol |
| `sec_type` | query | string | no | `STK` | Security type |
| `exchange` | query | string | no | `SMART` | Exchange routing |
| `currency` | query | string | no | `USD` | Currency |

### Response Schema — `QuoteData`

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
  "timestamp": "2025-02-07T21:00:00.000Z"
}
```

| Field | Type | Nullable | Description |
|---|---|---|---|
| `symbol` | `string` | no | Uppercase ticker |
| `bid` | `number` | yes | Best bid price |
| `ask` | `number` | yes | Best ask price |
| `last` | `number` | yes | Last traded price |
| `open` | `number` | yes | Session open |
| `high` | `number` | yes | Session high |
| `low` | `number` | yes | Session low |
| `close` | `number` | yes | Previous close |
| `volume` | `number` | yes | Session volume |
| `timestamp` | `string` | no | ISO 8601 timestamp of response |

**Timeout behavior:** If TWS doesn't send `tickSnapshotEnd` within 5 seconds, the quote resolves with whatever fields have been populated. Null fields indicate no data received for that tick type.

---

## 3. Get Historical Bars

**Purpose:** Retrieve historical OHLCV candlestick data.

### MCP Tool

```
Tool:   get_historical_bars
Params:
  symbol:       string   (required)
  duration:     string   (optional)  — "30 D", "13 W", "6 M", "1 Y"  (default: "30 D")
  bar_size:     string   (optional)  — "1 min", "5 mins", "15 mins", "1 hour", "1 day" (default: "1 day")
  what_to_show: string   (optional)  — TRADES, MIDPOINT, BID, ASK (default: "TRADES")
  use_rth:      boolean  (optional)  — Regular trading hours only (default: true)
```

### REST Endpoint

```
GET /api/history/{symbol}?duration=30+D&bar_size=1+day&what_to_show=TRADES&use_rth=true
```

| Parameter | In | Type | Required | Default | Description |
|---|---|---|---|---|---|
| `symbol` | path | string | yes | — | Ticker symbol |
| `duration` | query | string | no | `30 D` | Lookback period |
| `bar_size` | query | string | no | `1 day` | Candle interval |
| `what_to_show` | query | string | no | `TRADES` | Price basis |
| `use_rth` | query | string | no | `true` | `"true"` or `"false"` |

### Response Schema

```json
{
  "symbol": "AAPL",
  "count": 22,
  "bars": [
    {
      "time": "20250106",
      "open": 243.50,
      "high": 245.80,
      "low": 242.10,
      "close": 244.90,
      "volume": 62341000,
      "wap": 244.12,
      "barCount": 485210
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `time` | `string` | Bar timestamp (format varies by bar size) |
| `open` | `number` | Open price |
| `high` | `number` | High price |
| `low` | `number` | Low price |
| `close` | `number` | Close price |
| `volume` | `number` | Volume |
| `wap` | `number` | Volume-weighted average price |
| `barCount` | `number \| undefined` | Number of trades in bar |

**Timeout behavior:** 30-second timeout. If some bars arrived before timeout, they are returned. If zero bars arrived, the request rejects with an error.

---

## 4. Get Contract Details

**Purpose:** Retrieve metadata for a stock contract — conId, industry classification, trading hours.

### MCP Tool

```
Tool:   get_contract_details
Params:
  symbol: string (required)
```

### REST Endpoint

```
GET /api/contract/{symbol}
```

### Response Schema — `ContractDetailsResult[]`

```json
[
  {
    "conId": 265598,
    "symbol": "AAPL",
    "secType": "STK",
    "exchange": "SMART",
    "currency": "USD",
    "longName": "APPLE INC",
    "industry": "Technology",
    "category": "Computers",
    "subcategory": "Consumer Electronics",
    "minTick": 0.01,
    "tradingHours": "20250207:0400-20250207:2000;..."
  }
]
```

---

## 5. Get Options Chain

**Purpose:** Discover all available option expirations and strikes for an underlying.

### MCP Tool

```
Tool:   get_options_chain
Params:
  symbol: string (required) — Underlying stock symbol
```

### REST Endpoint

```
GET /api/options/{symbol}
```

### Response Schema — `OptionsChainData`

```json
{
  "symbol": "AAPL",
  "exchanges": ["SMART", "CBOE", "AMEX"],
  "expirations": ["20250214", "20250221", "20250228"],
  "strikes": [200, 205, 210, 215, 220, 225, 230]
}
```

| Field | Type | Description |
|---|---|---|
| `symbol` | `string` | Underlying symbol |
| `exchanges` | `string[]` | Available option exchanges |
| `expirations` | `string[]` | Sorted expiration dates (YYYYMMDD) |
| `strikes` | `number[]` | Sorted strike prices |

**Note:** This endpoint first calls `getContractDetails()` internally to obtain the `conId` required by TWS's `reqSecDefOptParams`. This adds latency but is unavoidable.

---

## 6. Get Option Quote

**Purpose:** Retrieve a real-time snapshot quote for a specific option contract.

### MCP Tool

```
Tool:   get_option_quote
Params:
  symbol: string        (required) — Underlying symbol, e.g. "AAPL"
  expiry: string        (required) — Expiration YYYYMMDD, e.g. "20260320"
  strike: number        (required) — Strike price, e.g. 220
  right:  "C" | "P"     (required) — Call or Put
```

### REST Endpoint

```
GET /api/options/{symbol}/quote?expiry=20260320&strike=220&right=C
```

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `symbol` | path | string | yes | Underlying symbol |
| `expiry` | query | string | yes | Expiration date YYYYMMDD |
| `strike` | query | number | yes | Strike price |
| `right` | query | string | yes | `C` (Call) or `P` (Put) |

### Response Schema

Same as `QuoteData` (Section 2), with `symbol` field formatted as `"AAPL 20260320 220 C"`.

**Validation (REST only):** Returns HTTP 400 if `expiry`, `strike`, or `right` are missing or invalid.

---

## 7. Get Account Summary

**Purpose:** Retrieve account financial summary — balances, margin, buying power.

### MCP Tool

```
Tool:   get_account_summary
Params: (none)
```

### REST Endpoint

```
GET /api/account/summary
```

### Response Schema — `AccountSummaryData`

```json
{
  "account": "U1234567",
  "netLiquidation": 125430.50,
  "totalCashValue": 45200.00,
  "settledCash": 45200.00,
  "buyingPower": 180000.00,
  "grossPositionValue": 80230.50,
  "maintMarginReq": 24069.15,
  "excessLiquidity": 101361.35,
  "availableFunds": 101361.35,
  "currency": "USD",
  "timestamp": "2025-02-07T21:00:00.000Z"
}
```

| Field | Type | Nullable | Description |
|---|---|---|---|
| `account` | `string` | no | IBKR account ID |
| `netLiquidation` | `number` | yes | Total account value |
| `totalCashValue` | `number` | yes | Cash balance |
| `settledCash` | `number` | yes | Settled cash (T+1/T+2) |
| `buyingPower` | `number` | yes | Available buying power |
| `grossPositionValue` | `number` | yes | Total market value of positions |
| `maintMarginReq` | `number` | yes | Maintenance margin requirement |
| `excessLiquidity` | `number` | yes | Excess liquidity |
| `availableFunds` | `number` | yes | Available funds |
| `currency` | `string` | no | Base currency |
| `timestamp` | `string` | no | ISO 8601 timestamp |

**Tags requested:** `NetLiquidation, TotalCashValue, SettledCash, BuyingPower, GrossPositionValue, MaintMarginReq, ExcessLiquidity, AvailableFunds`

---

## 8. Get Positions

**Purpose:** List all current portfolio positions.

### MCP Tool

```
Tool:   get_positions
Params: (none)
```

### REST Endpoint

```
GET /api/account/positions
```

### Response Schema

```json
{
  "count": 3,
  "positions": [
    {
      "account": "U1234567",
      "symbol": "AAPL",
      "secType": "STK",
      "exchange": "",
      "currency": "USD",
      "position": 100,
      "avgCost": 185.42
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `account` | `string` | Account ID |
| `symbol` | `string` | Instrument symbol |
| `secType` | `string` | Security type (STK, OPT, FUT, etc.) |
| `exchange` | `string` | Exchange (may be empty for aggregate positions) |
| `currency` | `string` | Currency |
| `position` | `number` | Quantity held (negative = short) |
| `avgCost` | `number` | Average cost basis per unit |

---

## 9. Get PnL

**Purpose:** Retrieve daily profit-and-loss summary.

### MCP Tool

```
Tool:   get_pnl
Params: (none)
```

### REST Endpoint

```
GET /api/account/pnl
```

### Response Schema — `PnLData`

```json
{
  "account": "U1234567",
  "dailyPnL": 1250.30,
  "unrealizedPnL": 8430.00,
  "realizedPnL": -200.00,
  "timestamp": "2025-02-07T21:00:00.000Z"
}
```

| Field | Type | Nullable | Description |
|---|---|---|---|
| `account` | `string` | no | Account ID |
| `dailyPnL` | `number` | yes | Today's profit/loss |
| `unrealizedPnL` | `number` | yes | Open position P&L |
| `realizedPnL` | `number` | yes | Closed position P&L today |
| `timestamp` | `string` | no | ISO 8601 timestamp |

**Note:** This endpoint makes two TWS requests sequentially — first `getAccountSummary()` to discover the account ID, then `reqPnL()`. Expect higher latency (~2–3s).

---

## 10. Search Contracts

**Purpose:** Search for contracts by partial symbol or company name.

### MCP Tool

```
Tool:   search_contracts
Params:
  query: string (required) — Search term, e.g. "Apple" or "AA"
```

### REST Endpoint

```
GET /api/search?q=Apple
```

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `q` | query | string | yes | Search query |

### Response Schema

```json
{
  "count": 5,
  "results": [
    {
      "conId": 265598,
      "symbol": "AAPL",
      "secType": "STK",
      "primaryExchange": "NASDAQ",
      "currency": "USD",
      "derivativeSecTypes": ["OPT", "WAR"],
      "description": ""
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `conId` | `number` | IBKR contract ID |
| `symbol` | `string` | Ticker symbol |
| `secType` | `string` | Security type |
| `primaryExchange` | `string` | Primary listing exchange |
| `currency` | `string` | Trading currency |
| `derivativeSecTypes` | `string[]` | Available derivative types |
| `description` | `string` | Company description (may be empty) |

**Validation (REST only):** Returns HTTP 400 if `q` parameter is missing.

---

## Error Responses

### MCP

Errors are returned inline as text content with `isError: true`:

```json
{
  "content": [{ "type": "text", "text": "Error: Quote error for XYZ (200): No security definition has been found" }],
  "isError": true
}
```

### REST

Errors return HTTP 500 with a JSON body:

```json
{
  "error": "Quote error for XYZ (200): No security definition has been found"
}
```

Validation errors (missing required parameters) return HTTP 400.

---

## OpenAPI Specification

The full OpenAPI 3.1 specification is served at runtime:

```
GET /openapi.json
```

This spec is used to auto-import all 10 actions into ChatGPT's custom GPT editor. The `servers[0].url` defaults to `http://localhost:3000` and must be changed to the public ngrok URL when configuring ChatGPT.
