# IBKR TWS API Coverage

> **Purpose**: Explicit completeness checklist for IBKR TWS API integration. Measures coverage vs intended surface area, not just what exists.

This document catalogs all Interactive Brokers TWS API methods we intend to support, their implementation status, and references to implementation files. Serves as the backbone for roadmap prioritization and test planning.

**Source of truth**:
- `@stoqey/ib` TypeScript library (v1.5.3)
- [IBKR TWS API Documentation](https://interactivebrokers.github.io/tws-api/)
- Our implementation files in `src/ibkr/`

---

## Connection Management

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `connect()` | ✅ Done | connection.ts | Auto-reconnect, clientId randomization |
| `disconnect()` | ✅ Done | connection.ts | Cleanup, clear reconnect timer |
| `isConnected()` | ✅ Done | connection.ts | Connection state query |
| `reqCurrentTime()` | ✅ Done | data.ts | TWS server time verification |
| Event handlers (connected/disconnected/error) | ✅ Done | connection.ts | Core event loop |

---

## Market Data — Snapshot & Streaming

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `reqMktData()` | ✅ Done | marketdata.ts | Snapshot quotes (bid, ask, last, volume) |
| `cancelMktData()` | ✅ Done | marketdata.ts | Cancel streaming subscription |
| `reqMarketDataType()` | ✅ Done | data.ts | Set live/frozen/delayed/delayed-frozen |
| `reqRealTimeBars()` | ⏸️ Deferred | — | Issue [#105](https://github.com/dotcal604/market-data-bridge/issues/105) — needs streaming architecture |
| `cancelRealTimeBars()` | ⏸️ Deferred | — | Paired with reqRealTimeBars |
| `reqTickByTickData()` | ⏸️ Deferred | — | Tick-by-tick streaming (L1) |
| `cancelTickByTickData()` | ⏸️ Deferred | — | Paired with reqTickByTickData |
| `reqMktDepth()` | 🔴 Not started | — | Level 2 market depth (L2) |
| `cancelMktDepth()` | 🔴 Not started | — | Paired with reqMktDepth |
| `reqMktDepthExchanges()` | ✅ Done | data.ts | List exchanges supporting L2 |

---

## Historical Data

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `reqHistoricalData()` | 🔴 Not started | — | Historical bars (1m/5m/1d/etc.) — currently use Yahoo Finance |
| `cancelHistoricalData()` | 🔴 Not started | — | Paired with reqHistoricalData |
| `reqHistoricalTicks()` | ✅ Done | marketdata.ts | Historical tick data (TRADES, BID_ASK, MIDPOINT) |
| `reqHeadTimestamp()` | ✅ Done | data.ts | Earliest available data timestamp |
| `reqHistogramData()` | ✅ Done | data.ts | Price distribution histogram |

---

## Orders — Placement & Management

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `placeOrder()` | ✅ Done | orders.ts | Single order (MKT, LMT, STP, STP_LMT, TRAIL, etc.) |
| `cancelOrder()` | ✅ Done | orders.ts | Cancel by orderId |
| `reqOpenOrders()` | ✅ Done | orders.ts | Query all open orders |
| `reqAllOpenOrders()` | 🔴 Not started | — | All open orders across all clients |
| `reqAutoOpenOrders()` | ✅ Done | data.ts | Auto-bind new orders to this client |
| `reqCompletedOrders()` | ✅ Done | orders.ts | Historical completed orders |
| `reqOrderStatus()` | 🔴 Not started | — | Query status of specific order |
| `reqGlobalCancel()` | 🔴 Not started | — | Cancel all open orders (all symbols) |
| Bracket orders (OCA) | ✅ Done | orders.ts | `placeBracketOrder()` + `placeAdvancedBracket()` |
| Persistent order listeners | ✅ Done | orders.ts | Event-driven order status updates |
| One-message bracket | ⏸️ Blocked | — | Requires TWS 10.42+ and @stoqey/ib update |

---

## Executions & Commissions

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `reqExecutions()` | ✅ Done | orders.ts | Query execution history with filters |
| `reqCommissionReport()` | ✅ Done | orders.ts | Auto-received with executions |
| Execution event handlers | ✅ Done | orders.ts | Real-time fill notifications |

---

## Account & Portfolio

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `reqAccountSummary()` | ✅ Done | account.ts | NetLiquidation, BuyingPower, etc. |
| `cancelAccountSummary()` | 🔴 Not started | — | Paired with reqAccountSummary subscription |
| `reqAccountUpdates()` | 🔴 Not started | — | Real-time account value updates |
| `cancelAccountUpdates()` | 🔴 Not started | — | Paired with reqAccountUpdates |
| `reqPositions()` | ✅ Done | account.ts | All open positions |
| `cancelPositions()` | 🔴 Not started | — | Paired with reqPositions subscription |
| `reqPnL()` | ✅ Done | account.ts | Account-level P&L |
| `cancelPnL()` | 🔴 Not started | — | Paired with reqPnL subscription |
| `reqPnLSingle()` | ✅ Done | data.ts | Position-level P&L by symbol |
| `cancelPnLSingle()` | ✅ Done | data.ts | Paired with reqPnLSingle |

---

## Contract Lookups & Metadata

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `reqContractDetails()` | ✅ Done | contracts.ts | Full contract specification |
| `reqMatchingSymbols()` | ✅ Done | data.ts | Symbol search/autocomplete |
| `reqSecDefOptParams()` | 🔴 Not started | — | Option chain parameters (strikes, expirations) |
| `reqMarketRule()` | ✅ Done | data.ts | Price increment rules |
| `reqSmartComponents()` | ✅ Done | data.ts | SMART routing component mapping |

---

## News

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `reqNewsProviders()` | ✅ Done | news.ts | Available news providers |
| `reqNewsArticle()` | ✅ Done | news.ts | Fetch full article text |
| `reqHistoricalNews()` | ✅ Done | news.ts | Historical news headlines |
| `reqNewsBulletins()` | ✅ Done | news.ts | Exchange bulletins |
| `cancelNewsBulletins()` | 🔴 Not started | — | Paired with reqNewsBulletins subscription |

---

## Scanner (Market Screener)

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `reqScannerParameters()` | 🔴 Not started | — | XML schema of available scanner filters |
| `reqScannerSubscription()` | 🔴 Not started | — | Live scanner results (top gainers, most active, etc.) |
| `cancelScannerSubscription()` | 🔴 Not started | — | Paired with reqScannerSubscription |

**Note**: Currently using Yahoo Finance for screeners (`run_screener`, `run_screener_with_quotes`). IBKR scanner integration deferred.

---

## Options Analytics

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `calculateImpliedVolatility()` | ✅ Done | data.ts | IV calculation from option price |
| `cancelCalculateImpliedVolatility()` | ✅ Done | data.ts | Cancel IV request |
| `calculateOptionPrice()` | ✅ Done | data.ts | Option price from IV (Black-Scholes) |
| `cancelCalculateOptionPrice()` | ✅ Done | data.ts | Cancel option price request |
| `reqSecDefOptParams()` | 🔴 Not started | — | Option chain metadata (strikes, expirations) |

---

## Fundamental Data

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `reqFundamentalData()` | ✅ Done | data.ts | Financial statements, ratios (XML) |
| `cancelFundamentalData()` | ✅ Done | data.ts | Cancel fundamental data request |

**Note**: Yahoo Finance is primary source for earnings, financials. IBKR fundamentals available as fallback.

---

## Financial Advisors (FA)

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `reqManagedAccts()` | N/A | — | Not applicable — single account system |
| `reqFA()` | N/A | — | Not applicable |
| `replaceFA()` | N/A | — | Not applicable |

**Rationale**: Market Data Bridge is designed for single-account retail trading. FA methods are not relevant to the intended use case.

---

## Bulletins & Notifications

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `reqNewsBulletins()` | ✅ Done | news.ts | Exchange bulletins, trading halts |
| `cancelNewsBulletins()` | 🔴 Not started | — | Paired with reqNewsBulletins subscription |

---

## Advanced Order Types & Algo Orders

| Method | Status | File | Notes |
|--------|--------|------|-------|
| Bracket orders (OCA) | ✅ Done | orders.ts | Entry + TP + SL in single call |
| Trailing stops | ✅ Done | orders.ts | TRAIL and TRAIL_LIMIT order types |
| Adaptive algo orders | ✅ Done | orders.ts | `placeAdvancedBracket()` supports adaptive algo |
| One-cancels-all (OCA) | ✅ Done | orders.ts | OCA groups for bracket orders |
| Attach orders (parent-child) | ✅ Done | orders.ts | Parent order with TP/SL children |

---

## Risk & Portfolio Analytics (Custom)

These are **not** native IBKR TWS API methods, but custom implementations using IBKR data:

| Method | Status | File | Notes |
|--------|--------|------|-------|
| `computePortfolioExposure()` | ✅ Done | portfolio.ts | Gross/net exposure, sector breakdown, beta-weighted |
| `runPortfolioStressTest()` | ✅ Done | portfolio.ts | Portfolio stress testing with beta shocks |
| `calculatePositionSize()` | ✅ Done | portfolio.ts | Risk-based position sizing (triple constraint) |
| `checkRisk()` | ✅ Done | risk-gate.ts | Pre-trade risk gate (max notional, penny stock filter) |
| `validateOrder()` | ✅ Done | orders.ts | Order parameter validation |
| `flattenAllPositions()` | ✅ Done | orders.ts | Flatten all positions to cash |

---

## Legend

- ✅ **Done** — Implemented and tested
- 🟡 **In progress** — Implementation started
- 🔴 **Not started** — Planned but not yet implemented
- ⏸️ **Deferred** — Blocked by dependency or architectural decision
- N/A — Not applicable to our use case

---

## Coverage Summary (by category)

| Category | Done | Deferred | Not Started | N/A | Total |
|----------|------|----------|-------------|-----|-------|
| Connection | 5 | 0 | 0 | 0 | 5 |
| Market Data | 4 | 4 | 2 | 0 | 10 |
| Historical Data | 3 | 0 | 2 | 0 | 5 |
| Orders | 7 | 1 | 2 | 0 | 10 |
| Executions | 2 | 0 | 0 | 0 | 2 |
| Account & Portfolio | 4 | 0 | 4 | 0 | 8 |
| Contracts | 4 | 0 | 1 | 0 | 5 |
| News | 4 | 0 | 1 | 0 | 5 |
| Scanner | 0 | 0 | 3 | 0 | 3 |
| Options | 4 | 0 | 1 | 0 | 5 |
| Fundamentals | 2 | 0 | 0 | 0 | 2 |
| Financial Advisors | 0 | 0 | 0 | 3 | 3 |
| Bulletins | 1 | 0 | 1 | 0 | 2 |
| **Total** | **40** | **5** | **17** | **3** | **65** |

**Coverage Rate**: 40/62 eligible methods = **64.5%**

---

## Roadmap Priorities

### High Priority (Edge Impact)

1. **Historical bars** (`reqHistoricalData`) — Currently relying on Yahoo Finance. IBKR provides intraday bars with better accuracy for backtesting.
   - Effort: Medium
   - Blocks: Eval engine historical replay, backtest validation

2. **Real-time bars** (`reqRealTimeBars`) — 5-second bars for intraday momentum. Requires streaming architecture (#105).
   - Effort: High (needs WebSocket/streaming refactor)
   - Blocks: Real-time intraday feature extraction

3. **Scanner subscription** (`reqScannerSubscription`) — Native IBKR scanner integration. Currently using Yahoo Finance screeners.
   - Effort: Medium
   - Value: IBKR scanner has more filters (liquidity, float, short interest)

### Medium Priority (Observability)

4. **Account updates subscription** (`reqAccountUpdates`) — Real-time account value updates. Currently polling via `reqAccountSummary`.
   - Effort: Low
   - Value: Reduces polling overhead

5. **Position subscription** (`reqPositions` + `cancelPositions`) — Real-time position updates.
   - Effort: Low
   - Value: Paired with WebSocket updates

### Low Priority (Nice-to-Have)

6. **Option chain params** (`reqSecDefOptParams`) — Option screener, strike selection.
   - Effort: Low
   - Value: Low (not option-focused strategy)

7. **Global cancel** (`reqGlobalCancel`) — Emergency kill switch.
   - Effort: Trivial
   - Value: Risk protection (already have `cancelAllOrders`)

---

## Implementation Notes

### Why Yahoo Finance is Primary for Some Data

- **Historical bars**: Yahoo Finance provides daily/weekly bars with no request limits. IBKR historical data has pacing rules (60 req/10min).
- **Screeners**: Yahoo Finance has 7 pre-built screeners with no authentication required. IBKR scanner requires TWS connection.
- **Fundamentals**: Yahoo Finance earnings/financials are free and structured. IBKR fundamentals are XML-based and harder to parse.

**Strategy**: Use Yahoo Finance for bulk/historical data. Use IBKR for real-time quotes, order execution, and position tracking.

### Streaming API Architecture (Issue #105)

Several methods are marked "Deferred" due to pending streaming architecture decisions:
- `reqRealTimeBars` / `reqTickByTickData` — Require persistent subscriptions
- Current system uses request/response pattern — need to add subscription management

**Architectural decision required**:
1. Add WebSocket layer for real-time updates
2. Subscription lifecycle management (start, pause, cancel)
3. Reconnection logic for streaming subscriptions

---

## Maintenance

This document should be updated when:
- New methods are implemented (move from "Not started" to "Done")
- Methods are deprioritized or blocked (move to "Deferred")
- New IBKR API methods are added to @stoqey/ib
- Methods are removed from scope (move to "N/A" with rationale)

**Review cadence**: Quarterly, or when @stoqey/ib is updated.

---

**Last updated**: 2026-02-16  
**@stoqey/ib version**: 1.5.3  
**Reviewer**: GitHub Copilot (initial draft from multi-model review finding)
