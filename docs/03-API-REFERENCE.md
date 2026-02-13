# IBKR Market Bridge — API Reference

This reference documents the current REST surface defined in `src/rest/routes.ts`.
All routes below are mounted under `/api`, so `GET /status` means `GET /api/status` at runtime.

## Response conventions

- Success: JSON object/array (shape varies by endpoint).
- Error: `{ "error": "message" }` with `4xx/5xx` status for validation/server errors.
- Some IBKR-dependent endpoints return `{ error: "IBKR not connected..." }` when TWS/Gateway is offline.

---

## 1) Market data and discovery

| Method | Path | Query Params | Request Body | Response Schema (high level) |
|---|---|---|---|---|
| GET | `/status` | none | none | `Status` (market session + connection metadata) |
| GET | `/quote/:symbol` | none | none | `Quote & { source: "ibkr" \| "yahoo" }` |
| GET | `/history/:symbol` | `period?`, `interval?` | none | `{ symbol, count, bars[] }` |
| GET | `/details/:symbol` | none | none | `StockDetails` |
| GET | `/options/:symbol` | `expiration?` | none | `OptionsChain` |
| GET | `/options/:symbol/quote` | `expiry` (required), `strike` (required), `right` (required: `C/P`) | none | `OptionQuote` |
| GET | `/search` | `q` (required) | none | `{ count, results[] }` |
| GET | `/news/:query` | none | none | `{ count, articles[] }` |
| GET | `/financials/:symbol` | none | none | `Financials` |
| GET | `/earnings/:symbol` | none | none | `EarningsData` |
| GET | `/trending` | `region?` | none | `TrendingSymbols` |
| GET | `/screener/filters` | none | none | `ScreenerFilterMap` |
| POST | `/screener/run` | none | `{ screener_id?: string, count?: number }` | `{ count, results[] }` |
| POST | `/screener/run-with-quotes` | none | `{ screener_id?: string, count?: number }` | `{ count, results[] }` |

---

## 2) Account, portfolio, and IBKR market microstructure

| Method | Path | Query Params | Request Body | Response Schema (high level) |
|---|---|---|---|---|
| GET | `/account/summary` | none | none | `AccountSummary` |
| GET | `/account/positions` | none | none | `{ count, positions[] }` |
| GET | `/account/pnl` | none | none | `PnL` |
| POST | `/portfolio/stress-test` | none | `{ shockPercent: number, betaAdjusted?: boolean }` | `StressTestResult` |
| GET | `/portfolio/exposure` | none | none | `PortfolioExposure` |
| GET | `/account/orders` | none | none | `{ count, orders[] }` |
| GET | `/account/orders/completed` | none | none | `{ count, orders[] }` |
| GET | `/account/executions` | `symbol?`, `secType?`, `time?` | none | `{ count, executions[] }` |
| GET | `/contract/:symbol` | `secType?`, `exchange?`, `currency?` | none | `{ count, contracts[] }` |
| GET | `/ibkr/quote/:symbol` | `secType?`, `exchange?`, `currency?` | none | `IBKRQuote` |

---

## 3) Orders and flatten controls

| Method | Path | Query Params | Request Body | Response Schema (high level) |
|---|---|---|---|---|
| POST | `/order` | none | Single-order payload (symbol/action/orderType/qty + optional IBKR fields) | `OrderPlacementResult` |
| POST | `/order/bracket` | none | `{ symbol, action, totalQuantity, entryType, entryPrice?, takeProfitPrice, stopLossPrice, ... }` | `BracketResult` |
| POST | `/order/bracket-advanced` | none | `{ symbol, action, quantity, entry, takeProfit, stopLoss, ... }` | `AdvancedBracketResult` |
| DELETE | `/order/:orderId` | none | none | `CancelOrderResult` |
| DELETE | `/orders/all` | none | none | `CancelAllResult` |
| POST | `/positions/flatten` | none | none | `FlattenResult` |
| GET | `/flatten/config` | none | none | `FlattenConfig` |
| POST | `/flatten/enable` | none | `{ enabled: boolean }` | `FlattenConfig` |

### `/order` request body notes

`POST /order` accepts a broad IBKR order schema. Common required fields:

- `symbol: string`
- `action: "BUY" | "SELL"`
- `orderType: string` (for example `MKT`, `LMT`, `STP`, `TRAIL`)
- `totalQuantity: number`

Optional fields include (non-exhaustive): `lmtPrice`, `auxPrice`, `tif`, `secType`, `exchange`, `currency`, `outsideRth`, `algoStrategy`, OCA fields, trailing fields, and strategy/journal metadata.

---

## 4) Session guardrails and risk sizing

| Method | Path | Query Params | Request Body | Response Schema (high level) |
|---|---|---|---|---|
| GET | `/session` | none | none | `SessionState` |
| POST | `/session/trade` | none | `{ realized_pnl: number }` | `SessionState` |
| POST | `/session/lock` | none | `{ reason?: string }` | `SessionState` |
| POST | `/session/unlock` | none | none | `SessionState` |
| POST | `/session/reset` | none | none | `SessionState` |
| POST | `/risk/size-position` | none | `{ symbol, entryPrice, stopPrice, riskPercent?, riskAmount?, maxCapitalPercent? }` | `PositionSizingResult` |

---

## 5) Trade journal and historical records

| Method | Path | Query Params | Request Body | Response Schema (high level) |
|---|---|---|---|---|
| GET | `/journal` | `symbol?`, `strategy?`, `limit?` | none | `{ count, entries[] }` |
| GET | `/journal/:id` | none | none | `JournalEntry` |
| POST | `/journal` | none | Journal entry payload (`reasoning` required) | `JournalEntry` (201) |
| PATCH | `/journal/:id` | none | Partial journal fields | `JournalEntry` |
| GET | `/orders/history` | `symbol?`, `strategy?`, `limit?` | none | `{ count, orders[] }` |
| GET | `/executions/history` | `symbol?`, `limit?` | none | `{ count, executions[] }` |

---

## 6) Collaboration channel and assistant sync

| Method | Path | Query Params | Request Body | Response Schema (high level) |
|---|---|---|---|---|
| GET | `/collab/messages` | `since?`, `author?`, `tag?`, `limit?` | none | `{ count, messages[] }` |
| POST | `/collab/message` | none | `{ author, content, replyTo?, tags? }` | `CollabMessage` (201) |
| DELETE | `/collab/messages` | none | none | `ClearResult` |
| GET | `/collab/stats` | none | none | `CollabStats` |
| GET | `/gpt-instructions` | none | none | `{ role: "system", instructions: string }` |

---

## Validation and edge-case behavior

- Symbol validation is enforced for order and risk-critical endpoints.
- Numeric safety checks are applied to quantities/prices/limits.
- Bracket endpoints enforce required dependent fields.
- Collaboration `author` must be one of `claude`, `chatgpt`, or `user`.
- Query `limit` values are clamped using an internal safe parser.
