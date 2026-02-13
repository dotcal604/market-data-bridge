# IBKR Market Bridge — Architecture & Design Document

---

## 1. System Context

```
┌──────────────┐     stdio (MCP)     ┌──────────────────┐      TCP socket       ┌──────────────┐
│  Claude       │◄──────────────────►│                  │◄─────────────────────►│              │
│  Desktop/Code │     56 tools       │   Market Data    │                       │  TWS /       │
└──────────────┘                     │   Bridge         │                       │  IB Gateway  │
                                     │   (Node.js)      │                       │              │
┌──────────────┐    HTTPS (REST)     │                  │      Yahoo Finance    │  Port 7496   │
│  ChatGPT      │◄──────────────────►│  Port 3000       │◄─────────────────────►│  or 7497     │
│  Custom GPT   │  47 endpoints      │                  │     (fallback)        └──────────────┘
└──────────────┘                     │                  │
                                     │  ┌──────────────┐│
┌──────────────┐    WebSocket        │  │  SQLite DB   ││
│  Frontend     │◄──────────────────►│  │  - Evals     ││
│  Next.js      │   real-time        │  │  - Journal   ││
└──────────────┘                     │  │  - Orders    ││
                                     │  └──────────────┘│
┌──────────────┐                     │                  │
│  Claude AI    │────┐                │  ┌──────────────┤
│  GPT-4o       │    ├───API calls──►│  │  Eval Engine │
│  Gemini Flash │────┘                │  └──────────────┘
└──────────────┘                     └──────────────────┘
```

The bridge is a full-featured trading platform adapter. It converts TWS API's asynchronous event-driven protocol into synchronous request/response interfaces: MCP (56 tools for Claude) and REST (47 endpoints for ChatGPT). It includes a multi-model AI evaluation engine, risk management system, and trade journal. All interfaces share the same IBKR service layer and single TWS socket connection.

---

## 2. Architectural Style

**Layered Architecture** with five tiers:

| Layer | Responsibility | Files |
|---|---|---|
| **Interface** | Accept requests from AI clients, format responses | `mcp/server.ts` (56 tools), `rest/routes.ts` (48 endpoints), `eval/routes.ts` (16 endpoints), `rest/server.ts`, `rest/openapi.ts`, `ws/server.ts` |
| **Service** | Business logic — request TWS data, order execution, risk checks, position sizing | `ibkr/marketdata.ts`, `ibkr/account.ts`, `ibkr/orders.ts`, `ibkr/portfolio.ts`, `ibkr/risk.ts`, `ibkr/risk-gate.ts`, `providers/yahoo.ts` |
| **Evaluation** | Multi-model AI evaluation, feature computation, ensemble scoring, guardrails | `eval/features/compute.ts`, `eval/models/runner.ts`, `eval/ensemble/scorer.ts`, `eval/guardrails/` |
| **Data** | Persistent storage, queries, reconciliation | `db/database.ts`, `collab/store.ts`, `eval/ensemble/weights.ts` |
| **Infrastructure** | TWS socket lifecycle, configuration, logging, scheduling | `ibkr/connection.ts`, `config.ts`, `logging.ts`, `scheduler.ts` |

### Key Architectural Decisions

| # | Decision | Rationale |
|---|---|---|
| AD-1 | Single process, triple interface | Simplifies deployment. MCP (stdio), REST (TCP), and WebSocket (HTTP upgrade) coexist without conflict. |
| AD-2 | Singleton IBApi instance | TWS allows one socket per `clientId`. A singleton ensures all requests share the connection and avoids ID conflicts. |
| AD-3 | Promise wrapping with `settled` guard | TWS events are asynchronous and can fire multiple times (or race with timeouts). A `settled` flag ensures each Promise resolves or rejects exactly once. |
| AD-4 | Request ID isolation | Every TWS request gets a unique monotonic `reqId`. Event handlers filter on `reqId` so concurrent requests don't interfere. |
| AD-5 | Yahoo Finance fallback | When IBKR disconnected, Yahoo Finance provides delayed quotes. Allows market research when TWS unavailable. |
| AD-6 | Assist discretion mode | Evaluation engine produces scores and flags. Trader makes execution decision. No automated trading. |
| AD-7 | Multi-model ensemble | Three AI models (Claude + GPT-4o + Gemini) provide independent evaluations. Weighted consensus reduces single-model bias. |
| AD-8 | SQLite for persistence | better-sqlite3 with WAL mode provides fast synchronous queries for eval history, journal, and orders. |
| AD-9 | Pure feature functions | Feature computation is deterministic math with no side effects. Testable and reproducible. |
| AD-10 | Graceful degradation | The server starts even if TWS is offline. Auto-reconnect runs on a 5-second interval. Tools return errors until TWS is available. |

---

## 3. Component Model

### 3.1 Entry Point (`src/index.ts`)

Responsibilities:
- Parse `--mode` CLI argument (default: `"both"`)
- Attempt TWS connection; log warning and continue if it fails
- Start REST server (if mode is `rest` or `both`)
- Start MCP server on stdio (if mode is `mcp` or `both`)
- Register SIGINT/SIGTERM handlers for graceful shutdown

### 3.2 Configuration (`src/config.ts`)

Loads environment variables via `dotenv` with sensible defaults:

| Key | Default | Runtime Type |
|---|---|---|
| `IBKR_HOST` | `127.0.0.1` | `string` |
| `IBKR_PORT` | `7497` | `number` |
| `IBKR_CLIENT_ID` | `0` | `number` |
| `REST_PORT` | `3000` | `number` |

Exported as a frozen `const` object (`as const`) to prevent accidental mutation.

### 3.3 Connection Manager (`src/ibkr/connection.ts`)

**Pattern:** Singleton + Auto-Reconnect

```
                    getIB()
                      │
                      ▼
              ┌───────────────┐
              │  IBApi         │  ← singleton, created on first call
              │  instance      │
              └───┬───┬───┬───┘
                  │   │   │
    connected ────┘   │   └──── error
                      │
               disconnected
                      │
                      ▼
            scheduleReconnect()
                      │
                 5s timeout
                      │
                      ▼
                connect()  ──► on success, clears reconnect timer
```

Key exports:
- `getIB()` — returns the singleton, creating it if needed
- `connect()` — returns a Promise that resolves on connection, rejects on timeout (10s) or fatal error
- `disconnect()` — tears down connection and cancels reconnect timer
- `getNextReqId()` — monotonic counter for TWS request IDs
- `isConnected()` / `getConnectionStatus()` — introspection

**Error Handling:** Uses `isNonFatalError(code, err)` from `@stoqey/ib` to filter out informational messages (codes 2104, 2106, 2158, etc.) that TWS sends as "errors" but are actually status updates.

### 3.4 Market Data Service (`src/ibkr/market-data.ts`)

Four functions, all returning Promises:

| Function | TWS API Call | Events Listened | Timeout |
|---|---|---|---|
| `getQuote()` | `reqMktData(snapshot=true)` | `tickPrice`, `tickSize`, `tickSnapshotEnd` | 5s (resolves partial data) |
| `getHistoricalBars()` | `reqHistoricalData()` | `historicalData` | 30s (resolves partial if bars exist) |
| `getOptionsChain()` | `reqSecDefOptParams()` | `securityDefinitionOptionParameter`, `...End` | 15s |
| `getOptionQuote()` | `reqMktData(snapshot=true)` | `tickPrice`, `tickSize`, `tickSnapshotEnd` | 5s (resolves partial data) |

**TickType Handling:** The `TickType` export from `@stoqey/ib` is a type-only union (not a runtime enum). Numeric constants are defined locally: `BID=1, ASK=2, LAST=4, HIGH=6, LOW=7, VOLUME=8, CLOSE=9, OPEN=14`.

**Historical Data End-of-Stream:** TWS signals completion by sending a bar with `time.startsWith("finished")` — there is no separate `historicalDataEnd` event in this library version.

### 3.5 Account Service (`src/ibkr/account.ts`)

| Function | TWS API Call | Events | Timeout |
|---|---|---|---|
| `getAccountSummary()` | `reqAccountSummary()` | `accountSummary`, `accountSummaryEnd` | 10s |
| `getPositions()` | `reqPositions()` | `position`, `positionEnd` | 10s (resolves partial) |
| `getPnL()` | `reqPnL()` | `pnl` | 10s (resolves partial) |

`getPnL()` first calls `getAccountSummary()` internally to discover the account ID, then subscribes to PnL updates.

### 3.6 Contracts Service (`src/ibkr/contracts.ts`)

**Contract Builders** (pure functions, no I/O):

| Function | Security Type | Notes |
|---|---|---|
| `stockContract()` | `STK` | Default exchange: SMART, currency: USD |
| `forexContract()` | `CASH` | Parses 6-char pair (e.g., "EURUSD") into symbol + currency |
| `optionContract()` | `OPT` | Multiplier hardcoded to 100; right mapped via `OptionType` enum |
| `futureContract()` | `FUT` | Requires explicit exchange |

**Lookup Functions:**

| Function | TWS API Call | Timeout |
|---|---|---|
| `getContractDetails()` | `reqContractDetails()` | 10s |
| `searchContracts()` | `reqMatchingSymbols()` | 10s |

`searchContracts` filters out results where `desc.contract` is `undefined` before mapping.

### 3.7 MCP Server (`src/mcp/server.ts`)

Registers 10 tools on a `McpServer` instance using `server.tool(name, description, zodSchema, handler)`. Each handler wraps the corresponding service function in try/catch and returns `{ content: [{ type: "text", text: JSON.stringify(...) }] }`.

### 3.8 REST Server (`src/rest/server.ts`, `routes.ts`, `openapi.ts`)

Express application with:
- CORS enabled (all origins)
- JSON body parsing
- Routes mounted at `/api/*`
- OpenAPI 3.1 spec served at `/openapi.json`
- Health check at `/`

A `qs()` helper safely extracts query parameters from Express v5's strict `req.query` type.

---

## 4. Concurrency Model

### 4.1 The Settled Guard Pattern

Every Promise-wrapped TWS function follows this template:

```typescript
return new Promise((resolve, reject) => {
    let settled = false;               // ① Guard flag

    const timeout = setTimeout(() => {
        if (settled) return;            // ② Skip if already resolved
        settled = true;
        cleanup();
        resolve(partialData);           // ③ Resolve with whatever we have
    }, TIMEOUT_MS);

    const onComplete = (id) => {
        if (id !== reqId) return;       // ④ Ignore other requests
        if (settled) return;            // ⑤ Skip if already resolved
        settled = true;
        cleanup();
        resolve(fullData);
    };

    const onError = (err, code, id) => {
        if (id !== reqId) return;
        if (isNonFatalError(code, err)) return;  // ⑥ Ignore info codes
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
    };

    const cleanup = () => {             // ⑦ Remove all listeners
        clearTimeout(timeout);
        ib.off(EventName.xxx, onComplete);
        ib.off(EventName.error, onError);
    };

    ib.on(EventName.xxx, onComplete);
    ib.on(EventName.error, onError);
    ib.reqXxx(reqId, ...);
});
```

This pattern prevents:
- **Double-resolve:** Timeout and completion event fire near-simultaneously
- **Listener leaks:** `cleanup()` removes all event handlers on every exit path
- **Cross-request contamination:** `reqId` filtering ensures handlers only process their own responses

### 4.2 Concurrency Limits

The system is single-threaded (Node.js event loop). Multiple REST requests can be in-flight concurrently, each with its own `reqId`, listeners, and timeout. The `settled` guard ensures correctness under concurrent request scenarios.

---

## 5. Data Flow: Quote Request

```
  Client (Claude or ChatGPT)
        │
        │  "Get AAPL quote"
        ▼
  ┌─────────────────────┐
  │  MCP Tool / REST     │  ← Interface layer
  │  get_quote("AAPL")   │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  market-data.ts      │  ← Service layer
  │  getQuote("AAPL")    │
  │                      │
  │  1. Build contract   │
  │  2. Allocate reqId   │
  │  3. Register events  │
  │  4. reqMktData()     │──────►  TWS (TCP socket)
  │                      │
  │  ◄── tickPrice(BID)  │◄──────  TWS events
  │  ◄── tickPrice(ASK)  │
  │  ◄── tickSize(VOL)   │
  │  ◄── tickSnapshotEnd │
  │                      │
  │  5. Cleanup, resolve │
  └──────────┬──────────┘
             │
             ▼
        JSON response
        │
        ▼
  Client receives quote
```

---

## 6. Security Considerations

| Concern | Mitigation |
|---|---|
| **No REST authentication** | REST API is designed for local-only access. External exposure should only occur through a secured tunnel (ngrok with auth, Cloudflare Tunnel, etc.). |
| **Account data exposure** | Read-only by design. No order-placement capability exists in code. Account data is only accessible to whoever can reach the REST port or invoke MCP tools. |
| **TWS API socket** | Communication is over localhost TCP. No TLS on the TWS-to-bridge connection (standard IBKR design). |
| **Client ID collision** | If another application uses the same `clientId`, TWS will disconnect one of them. Use a unique ID in `.env`. |

---

## 7. Failure Modes

| Failure | System Behavior | Recovery |
|---|---|---|
| TWS not running at startup | Bridge starts, logs warning, all tool calls fail with error messages | Auto-reconnect every 5s; tools succeed once TWS connects |
| TWS disconnects mid-session | `disconnected` event fires, `isConnected()` returns false, reconnect timer starts | Automatic; in-flight requests may timeout |
| TWS request timeout | Promise resolves with partial data (quotes) or rejects with timeout error (historical, options chain) | Caller retries; no internal retry |
| Invalid symbol | TWS sends error event with code | Error propagated to caller with descriptive message |
| Port conflict (EADDRINUSE) | REST server fails to bind | Kill existing process on port, or change `REST_PORT` |
