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

IBKR Market Bridge is a full-featured trading integration server that connects Interactive Brokers' Trader Workstation (TWS) API to AI assistants — specifically Claude (via Model Context Protocol) and ChatGPT (via REST/OpenAPI custom actions). It translates the event-driven, callback-oriented TWS socket protocol into clean request/response interfaces consumable by language models.

The system operates in three modes: MCP-only (Claude), REST-only (ChatGPT), or dual-mode (both simultaneously). It provides comprehensive trading capabilities including market data, order execution, portfolio analytics, risk management, trade evaluation via multi-model AI ensemble, and trade journaling.

---

## 2. Business Objective

Enable a retail trader to query real-time and historical market data, execute trades, analyze setups with AI evaluation, manage risk, and maintain a comprehensive trade journal through natural-language conversations with AI assistants, without switching to the TWS desktop application.

### In-Scope

**Market Data & Research:**
- Real-time snapshot quotes for equities, ETFs, indices, and options (IBKR + Yahoo Finance)
- Historical OHLCV bar data at configurable intervals
- Options chain discovery (expirations, strikes, full chain data)
- Stock screeners (gainers, losers, most active, sector-specific)
- Company financials, earnings, news, trending symbols
- Symbol search and contract details

**Trading & Order Management:**
- Order placement: market, limit, stop, trailing stop, bracket orders
- Advanced bracket orders with OCA groups and adaptive algo
- Order status monitoring and cancellation
- Execution history with commission tracking
- Position flattening (individual or all positions)
- Auto-flatten scheduler for end-of-day risk management

**Portfolio & Risk Analytics:**
- Account summary (net liquidation, buying power, margin)
- Portfolio position listing with unrealized P&L
- Portfolio exposure analysis (gross/net, sector breakdown, beta-weighted)
- Stress testing with customizable shock scenarios
- Risk-based position sizing (triple constraint: risk/capital/margin)

**Risk & Session Management:**
- Session state tracking (daily P&L, trade count, consecutive losses)
- Configurable risk gates (max daily loss, max consecutive losses, max trades)
- Manual session locks and cooldown periods
- Trade outcome recording for guardrail updates

**AI Evaluation Engine:**
- Multi-model trade evaluation (Claude + GPT-4o + Gemini)
- Ensemble scoring with weighted consensus
- Pre-filter and post-filter guardrails
- Model performance statistics and calibration drift detection
- Weight simulation and optimization
- Evaluation outcome tracking with R-multiple analysis

**Trade Journal & History:**
- Structured trade journal with reasoning, tags, and outcomes
- Historical order and execution queries
- TraderSync CSV import and integration
- Daily performance summaries

**Collaboration:**
- AI-to-AI collaboration channel for multi-agent workflows
- Message posting, reading, and statistics

### Out-of-Scope

- Multi-account management (uses first detected account)
- Futures and forex contract quoting (contract builders exist but no dedicated endpoints)
- Complex options strategies (spreads, straddles, etc.) — only single-leg options quotes
- Custom technical indicators (feature engine uses predefined calculations)

---

## 3. Stakeholders

| Role | Responsibility |
|---|---|
| **End User / Trader** | Executes trades, queries market data, receives AI trade evaluations |
| **System Operator** | Starts TWS, launches the bridge, configures API keys, manages evaluation engine |
| **AI Assistant (Claude)** | Consumes 56 MCP tools via stdio transport |
| **AI Assistant (ChatGPT)** | Consumes 47 REST endpoints via OpenAPI actions |
| **AI Evaluation Models** | Claude Sonnet, GPT-4o, Gemini Flash provide trade setup analysis |
| **IBKR TWS/Gateway** | Upstream broker; provides market data, account info, order execution over TCP socket |
| **Yahoo Finance** | Backup market data provider when IBKR unavailable |

---

## 4. Key Constraints

| Constraint | Detail |
|---|---|
| **TWS must be running for IBKR data** | IBKR quotes and account data require TWS connection. Yahoo Finance provides backup quotes when TWS unavailable. |
| **Market data subscriptions** | IBKR requires active market data subscriptions for real-time quotes. Paper accounts receive delayed data (15–20 min). |
| **Single client ID** | The bridge uses one `clientId` (default `0`). TWS allows at most 32 concurrent API connections. |
| **API keys required** | REST API requires API key authentication. Evaluation engine requires Claude, OpenAI, and Google API keys. |
| **SQLite database** | Uses better-sqlite3 with WAL mode for evaluation history, journal, and order reconciliation. |
| **Assist discretion mode** | Evaluation engine produces scores and guardrail flags. Trader makes final execution decision. No automated trading. |
| **Rate limits** | REST API enforces rate limits: 100 req/min global, 10/min for orders, 10/min for evaluations. |

---

## 5. Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Runtime | Node.js | 18+ | JavaScript/TypeScript execution |
| Language | TypeScript | 5.7.3 | Static typing, strict mode |
| IBKR Client | `@stoqey/ib` | 1.5.3 | TWS API TCP socket client |
| Yahoo Finance | `yahoo-finance2` | latest | Market data fallback provider |
| MCP SDK | `@modelcontextprotocol/sdk` | 1.12.1 | Claude tool registration (56 tools) |
| HTTP Framework | Express | 4.21.2 | REST API server (47 endpoints) |
| Database | `better-sqlite3` | latest | Local SQLite for evaluations, journal, orders |
| Schema Validation | Zod | 3.25.0 | Input validation and type safety |
| Logger | Pino | latest | Structured logging |
| Rate Limiting | `express-rate-limit` | latest | API rate limiting |
| WebSocket | `ws` | latest | Real-time position/order updates |
| AI SDKs | `@anthropic-ai/sdk`, `openai`, `@google/genai` | latest | Multi-model evaluation engine |
| CORS | `cors` | 2.8.5 | Cross-origin support |
| Environment | `dotenv` | 16.4.7 | Configuration management |
| Tunnel (optional) | ngrok | latest | Public URL for ChatGPT |

---

## 6. Project Structure

```
market-data-bridge/
├── src/
│   ├── index.ts               # Entry point — MCP + REST + IBKR startup
│   ├── config.ts              # Environment variable loading
│   ├── logging.ts             # Pino logger setup
│   ├── scheduler.ts           # Auto-flatten scheduler, position/account snapshots
│   ├── suppress-stdout.ts     # MCP stdout isolation
│   ├── ibkr/
│   │   ├── connection.ts      # TWS connection lifecycle
│   │   ├── marketdata.ts      # Real-time quotes
│   │   ├── account.ts         # Account summary, positions, PnL
│   │   ├── orders.ts          # Order placement, cancellation, queries
│   │   ├── contracts.ts       # Contract resolution
│   │   ├── portfolio.ts       # Exposure analysis, stress testing
│   │   ├── risk.ts            # Position sizing
│   │   └── risk-gate.ts       # Session state, trade recording, locks
│   ├── providers/
│   │   ├── yahoo.ts           # Yahoo Finance wrapper (quotes, bars, screeners)
│   │   └── status.ts          # Market session detection
│   ├── db/
│   │   ├── database.ts        # SQLite schema, queries, prepared statements
│   │   └── reconcile.ts       # Boot-time order reconciliation
│   ├── mcp/
│   │   └── server.ts          # MCP tool definitions (56 tools)
│   ├── rest/
│   │   ├── server.ts          # Express server, middleware, route mounting
│   │   ├── routes.ts          # Main REST endpoints (48 routes)
│   │   └── openapi.ts         # OpenAPI 3.1 spec generator
│   ├── ws/
│   │   ├── server.ts          # WebSocket server
│   │   └── broadcaster.ts     # Real-time update broadcaster
│   ├── collab/
│   │   └── store.ts           # AI collaboration message store
│   ├── eval/
│   │   ├── config.ts          # Eval engine configuration
│   │   ├── retry.ts           # Timeout and retry utilities
│   │   ├── types.ts           # Shared type definitions
│   │   ├── routes.ts          # Eval REST endpoints (16 routes)
│   │   ├── drift-detector.ts  # Model calibration drift analysis
│   │   ├── features/
│   │   │   ├── compute.ts     # Feature orchestrator
│   │   │   ├── types.ts       # FeatureVector definition
│   │   │   └── [27 feature modules]
│   │   ├── models/
│   │   │   ├── runner.ts      # Multi-model orchestrator
│   │   │   ├── types.ts       # ModelOutput, ModelEvaluation
│   │   │   ├── schema.ts      # Zod validation schemas
│   │   │   ├── prompt.ts      # System prompts
│   │   │   └── providers/
│   │   │       ├── claude.ts  # Anthropic SDK
│   │   │       ├── openai.ts  # OpenAI SDK
│   │   │       └── gemini.ts  # Google GenAI SDK
│   │   ├── ensemble/
│   │   │   ├── scorer.ts      # Weighted scoring, disagreement penalty
│   │   │   └── weights.ts     # Weight management, hot-reload
│   │   ├── guardrails/
│   │   │   ├── prefilter.ts   # Pre-model structural filters
│   │   │   └── behavioral.ts  # Post-ensemble checks
│   │   └── reasoning/
│   │       └── extractor.ts   # Structured reasoning extraction
│   └── tradersync/
│       └── importer.ts        # TraderSync CSV parser
├── analytics/
│   ├── recalibrate_weights.py # Python weight optimization script
│   └── README.md
├── data/
│   ├── bridge.db              # SQLite database (evaluations, journal, orders)
│   └── weights.json           # Ensemble model weights
├── build/                     # Compiled JavaScript output (tsc)
├── docs/                      # Documentation suite
├── .env                       # Runtime configuration (not committed)
├── .env.example               # Configuration template
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
