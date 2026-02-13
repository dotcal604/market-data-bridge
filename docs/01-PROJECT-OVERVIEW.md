# IBKR Market Bridge — Project Overview

| Field | Value |
|---|---|
| **Project Name** | IBKR Market Bridge (`ibkr-market-bridge`) |
| **Version** | 1.0.0 |
| **Type** | Integration Middleware / API Bridge |
| **Language** | TypeScript 5.7 (ES2022 target, Node16 module resolution) |
| **Runtime** | Node.js 18+ |
| **License** | Private |

---

## 1. Executive Summary

IBKR Market Bridge is a read-only integration server that connects Interactive Brokers' Trader Workstation (TWS) API to AI assistants — specifically Claude (via Model Context Protocol) and ChatGPT (via REST/OpenAPI custom actions). It translates the event-driven, callback-oriented TWS socket protocol into clean request/response interfaces consumable by language models.

The system operates in three modes: MCP-only (Claude), REST-only (ChatGPT), or dual-mode (both simultaneously). It is strictly read-only — it retrieves market data and account information but cannot place orders or modify account state.

---

## 2. Business Objective

Enable a retail trader to query real-time and historical market data, inspect portfolio positions, and review account metrics through natural-language conversations with AI assistants, without switching to the TWS desktop application.

### In-Scope

- Real-time snapshot quotes for equities, ETFs, indices, and options
- Historical OHLCV bar data at configurable intervals
- Options chain discovery (expirations, strikes, exchanges)
- Account summary (net liquidation value, buying power, margin, cash)
- Portfolio position listing
- Daily profit-and-loss reporting
- Contract search and detail lookup

### Out-of-Scope

- Order placement, modification, or cancellation
- Account settings or configuration changes
- Real-time streaming (WebSocket push)
- Multi-account management (uses first detected account)
- Forex or futures contract quoting (contract builders exist but no dedicated endpoints)

---

## 3. Stakeholders

| Role | Responsibility |
|---|---|
| **End User / Trader** | Queries market data and portfolio status via AI assistants |
| **System Operator** | Starts TWS, launches the bridge, manages ngrok tunnel |
| **AI Assistant (Claude)** | Consumes MCP tools via stdio transport |
| **AI Assistant (ChatGPT)** | Consumes REST endpoints via OpenAPI actions |
| **IBKR TWS/Gateway** | Upstream data source; provides market data and account info over TCP socket |

---

## 4. Key Constraints

| Constraint | Detail |
|---|---|
| **TWS must be running** | The bridge has no built-in data cache. All data comes from TWS in real-time. If TWS disconnects, requests fail until reconnection. |
| **Market data subscriptions** | IBKR requires active market data subscriptions for real-time quotes. Paper accounts receive delayed data (15–20 min). |
| **Single client ID** | The bridge uses one `clientId` (default `0`). TWS allows at most 32 concurrent API connections, but each must use a unique ID. |
| **ngrok free-tier URL rotation** | The public URL changes on every ngrok restart. ChatGPT's action schema must be updated accordingly. |
| **No authentication on REST** | The REST API has no auth middleware. It is designed for local use or behind a secured tunnel. |

---

## 5. Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Runtime | Node.js | 18+ | JavaScript/TypeScript execution |
| Language | TypeScript | 5.7.3 | Static typing, strict mode |
| IBKR Client | `@stoqey/ib` | 1.5.3 | TWS API TCP socket client |
| MCP SDK | `@modelcontextprotocol/sdk` | 1.12.1 | Claude tool registration |
| HTTP Framework | Express | 4.21.2 | REST API server |
| Schema Validation | Zod | 3.25.0 | MCP tool parameter schemas |
| CORS | `cors` | 2.8.5 | Cross-origin support for ChatGPT |
| Environment | `dotenv` | 16.4.7 | `.env` file loading |
| Tunnel (optional) | ngrok | latest | Public URL for ChatGPT |

---

## 6. Project Structure

```
ibkr-market-bridge/
├── src/
│   ├── index.ts              # Entry point — mode selection, startup orchestration
│   ├── config.ts             # Environment variable loading
│   ├── ibkr/
│   │   ├── connection.ts     # TWS connection lifecycle (connect, reconnect, singleton)
│   │   ├── market-data.ts    # Quotes, historical bars, options chain, option quotes
│   │   ├── account.ts        # Account summary, positions, PnL
│   │   └── contracts.ts      # Contract builders (stock, forex, option, future), search, details
│   ├── mcp/
│   │   └── server.ts         # MCP tool definitions (10 tools)
│   └── rest/
│       ├── server.ts         # Express app setup
│       ├── routes.ts         # REST route handlers (10 endpoints)
│       └── openapi.ts        # OpenAPI 3.1 specification object
├── build/                    # Compiled JavaScript output (tsc)
├── docs/                     # This documentation suite
├── .env                      # Runtime configuration (not committed)
├── .env.example              # Template for .env
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## 7. Document Index

| # | Document | Filename | Purpose |
|---|---|---|---|
| 1 | Project Overview | `01-PROJECT-OVERVIEW.md` | This document. Scope, stakeholders, constraints. |
| 2 | Architecture & Design | `02-ARCHITECTURE.md` | Component model, data flow, concurrency, design decisions. |
| 3 | API Reference | `03-API-REFERENCE.md` | Complete endpoint/tool specifications with schemas. |
| 4 | Deployment & Operations | `04-DEPLOYMENT-GUIDE.md` | Build, install, configure, run, monitor. |
| 5 | Troubleshooting & Runbook | `05-RUNBOOK.md` | Diagnostic procedures, error codes, recovery steps. |

---

## 8. Revision History

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2025-02-09 | System | Initial documentation suite |
