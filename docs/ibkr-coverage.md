# IBKR TWS API Coverage Checklist

This checklist maps **major** `@stoqey/ib` (`IBApi`) methods against current implementation status in `src/ibkr/*.ts`.

## Status legend

- **Done** — implemented and wired through current backend modules.
- **Partial** — implemented in a limited way (for example, one-shot request but not streaming architecture).
- **Not Started** — method not yet wrapped/used.
- **N/A** — intentionally out of scope for this project.

## Cross-reference notes

- Roadmap issue **#105** (“Subscription APIs (6 methods)”) is marked **Deferred** and directly affects streaming market-data coverage.
- Roadmap issue **#73** (“WebSocket real-time updates”) is marked **Parked** and blocks end-to-end push updates to clients.
- Source references: `ROADMAP.md`, `docs/maturity-rubric.md`.

---

| Category | Method | Status | File | Notes |
|---|---|---|---|---|
| Connection | `connect` | Done | `src/ibkr/connection.ts` | Core TWS connection bootstrap. |
| Connection | `disconnect` | Done | `src/ibkr/connection.ts` | Used for shutdown/reconnect flows. |
| Connection | `reqCurrentTime` | Done | `src/ibkr/data.ts` | Wrapped as utility endpoint/helper. |
| Connection | `setServerLogLevel` | N/A | — | Operational/debug API; not needed in app workflow. |
| Connection | `reqUserInfo` | N/A | — | Not required for trading/data workflows currently. |
| Market Data | `reqMktData` | Partial | `src/ibkr/marketdata.ts` | Currently used as **snapshot** quote path; streaming design deferred (#105/#73). |
| Market Data | `cancelMktData` | Partial | `src/ibkr/marketdata.ts` | Cancellation exists, but tied to snapshot lifecycle. |
| Market Data | `reqMarketDataType` | Done | `src/ibkr/data.ts` | Supports delayed/live/frozen selection. |
| Market Data | `reqTickByTickData` | Not Started | — | Part of deferred subscription APIs (#105). |
| Market Data | `cancelTickByTickData` | Not Started | — | Depends on tick-by-tick rollout (#105). |
| Market Data | `reqRealTimeBars` | Not Started | — | Streaming bars not yet implemented (#105). |
| Market Data | `cancelRealTimeBars` | Not Started | — | Paired with `reqRealTimeBars` (not implemented). |
| Market Data | `reqMktDepth` | Not Started | — | Level 2 stream not exposed yet; would also need client push path (#73). |
| Market Data | `cancelMktDepth` | Not Started | — | Paired depth cancel path not implemented. |
| Market Data | `reqMktDepthExchanges` | Done | `src/ibkr/data.ts` | Exchange capability discovery implemented. |
| Market Data | `reqSmartComponents` | Done | `src/ibkr/data.ts` | Smart routing component lookup implemented. |
| Market Data | `reqMarketRule` | Done | `src/ibkr/data.ts` | Market rule/tick increment lookup implemented. |
| Market Data | `calculateImpliedVolatility` | Done | `src/ibkr/data.ts` | Option analytics helper implemented. |
| Market Data | `cancelCalculateImpliedVolatility` | Done | `src/ibkr/data.ts` | Cleanup/timeouts implemented. |
| Market Data | `calculateOptionPrice` | Done | `src/ibkr/data.ts` | Option analytics helper implemented. |
| Market Data | `cancelCalculateOptionPrice` | Done | `src/ibkr/data.ts` | Cleanup/timeouts implemented. |
| Market Data | `reqHeadTimestamp` | Done | `src/ibkr/data.ts` | Historical boundary lookup implemented. |
| Market Data | `cancelHeadTimestamp` | Partial | `src/ibkr/data.ts` | Wrapper calls exist for request path; explicit cancel method not currently used. |
| Historical Data | `reqHistoricalData` | Not Started | — | Bars primarily sourced from Yahoo provider in current architecture. |
| Historical Data | `cancelHistoricalData` | Not Started | — | Paired cancel not implemented. |
| Historical Data | `reqHistoricalTicks` | Done | `src/ibkr/marketdata.ts` | Historical tick endpoint implemented. |
| Historical Data | `reqHistogramData` | Done | `src/ibkr/data.ts` | Histogram endpoint implemented. |
| Historical Data | `cancelHistogramData` | Partial | `src/ibkr/data.ts` | Request wrapper exists; explicit cancel API path not exposed. |
| Historical Data | `reqFundamentalData` | Done | `src/ibkr/data.ts` | Fundamental report retrieval implemented. |
| Historical Data | `cancelFundamentalData` | Done | `src/ibkr/data.ts` | Cancel path used for timeout/error cleanup. |
| Orders | `reqIds` | Done | `src/ibkr/orders.ts` | Next valid ID fetch used before order placement. |
| Orders | `placeOrder` | Done | `src/ibkr/orders.ts` | Single and bracket order flows implemented. |
| Orders | `cancelOrder` | Done | `src/ibkr/orders.ts` | Individual order cancel implemented. |
| Orders | `reqGlobalCancel` | Done | `src/ibkr/orders.ts` | Kill-switch style global cancel implemented. |
| Orders | `reqOpenOrders` | Not Started | — | Using `reqAllOpenOrders` in current design. |
| Orders | `reqAllOpenOrders` | Done | `src/ibkr/orders.ts` | Open-order listing implemented. |
| Orders | `reqAutoOpenOrders` | Done | `src/ibkr/data.ts` | Auto-bind toggle wrapper implemented. |
| Orders | `reqCompletedOrders` | Done | `src/ibkr/orders.ts` | Completed orders retrieval implemented. |
| Orders | `reqExecutions` | Done | `src/ibkr/orders.ts` | Execution + commission flow implemented. |
| Orders | `exerciseOptions` | N/A | — | Not in current equities-focused execution scope. |
| Orders | `reqSoftDollarTiers` | N/A | — | Institutional-specific; not in scope. |
| Account | `reqAccountSummary` | Done | `src/ibkr/account.ts` | Account summary retrieval implemented. |
| Account | `cancelAccountSummary` | Done | `src/ibkr/account.ts` | Proper request cleanup implemented. |
| Account | `reqAccountUpdates` | Not Started | — | Project uses summary/positions/PnL endpoints instead. |
| Account | `reqAccountUpdatesMulti` | Not Started | — | Multi-model/account variant not implemented. |
| Account | `cancelAccountUpdatesMulti` | Not Started | — | Paired cancel not implemented. |
| Account | `reqPnL` | Done | `src/ibkr/account.ts` | Account-level realtime/daily PnL endpoint implemented. |
| Account | `cancelPnL` | Done | `src/ibkr/account.ts` | Cleanup path implemented. |
| Portfolio | `reqPositions` | Done | `src/ibkr/account.ts` | Portfolio positions endpoint implemented. |
| Portfolio | `cancelPositions` | Done | `src/ibkr/account.ts` | Cleanup path implemented. |
| Portfolio | `reqPnLSingle` | Done | `src/ibkr/data.ts` | Per-position PnL helper implemented. |
| Portfolio | `cancelPnLSingle` | Done | `src/ibkr/data.ts` | Cleanup path implemented. |
| Portfolio | `reqPositionsMulti` | Not Started | — | Multi-account/model portfolio view not implemented. |
| Portfolio | `cancelPositionsMulti` | Not Started | — | Paired cancel not implemented. |
| Contracts | `reqContractDetails` | Done | `src/ibkr/contracts.ts` | Contract lookup/metadata implemented. |
| Contracts | `reqMatchingSymbols` | Done | `src/ibkr/data.ts` | Symbol search endpoint implemented. |
| Contracts | `reqSecDefOptParams` | Not Started | — | Options chain metadata not yet wrapped. |
| News | `reqNewsProviders` | Done | `src/ibkr/news.ts` | Provider discovery implemented. |
| News | `reqNewsArticle` | Done | `src/ibkr/news.ts` | Article retrieval implemented. |
| News | `reqHistoricalNews` | Done | `src/ibkr/news.ts` | Historical headline retrieval implemented. |
| News | `reqNewsBulletins` | Done | `src/ibkr/news.ts` | Bulletin subscription endpoint implemented. |
| News | `cancelNewsBulletins` | Done | `src/ibkr/news.ts` | Bulletin cancellation implemented. |
| Scanner | `reqScannerSubscription` | Not Started | — | Scanner stream not implemented. |
| Scanner | `cancelScannerSubscription` | Not Started | — | Paired cancel not implemented. |
| Scanner | `reqScannerParameters` | Not Started | — | Scanner schema not exposed yet. |
| Financial Advisors | `requestFA` | N/A | — | FA XML workflows are advisor-only; not applicable. |
| Financial Advisors | `replaceFA` | N/A | — | FA profile mutation out of scope. |
| Financial Advisors | `reqManagedAccts` | Partial | — | Useful for multi-account FA setups; currently single-account oriented and not wrapped. |
| Financial Advisors | `reqFamilyCodes` | N/A | — | Family code workflows out of scope (non-FA deployment). |
| Financial Advisors | `queryDisplayGroups` | N/A | — | TWS display-group synchronization not needed for server-side APIs. |
| Financial Advisors | `subscribeToGroupEvents` | N/A | — | Display-group eventing out of scope. |
| Financial Advisors | `unsubscribeFromGroupEvents` | N/A | — | Display-group eventing out of scope. |
| Financial Advisors | `updateDisplayGroup` | N/A | — | Display-group mutation out of scope. |

---

## Gap summary (high-level)

1. **Primary gap: streaming subscriptions**
   - `reqTickByTickData` / `cancelTickByTickData`
   - `reqRealTimeBars` / `cancelRealTimeBars`
   - richer `reqMktData` streaming lifecycle
   - These align with deferred roadmap item #105 and parked #73 WebSocket delivery.

2. **Secondary gap: scanner APIs**
   - All scanner methods are currently unimplemented.

3. **Mostly complete areas**
   - Core order lifecycle, account summary/PnL, contract details, and news stack are implemented.
