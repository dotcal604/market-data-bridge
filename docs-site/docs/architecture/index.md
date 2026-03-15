---
sidebar_position: 1
title: System Architecture
---

# Architecture Overview

Market Data Bridge connects AI assistants to financial markets through a modular TypeScript backend with 20+ subsystems.

## System Architecture

The high-level system diagram shows how AI clients connect through MCP and REST interfaces to the core backend, which integrates with external market data and AI model providers.

```mermaid
graph TB
    subgraph Clients["AI Clients"]
        Claude["Claude Desktop / Claude Code"]
        ChatGPT["ChatGPT Actions"]
        Browser["Web Browser"]
    end

    subgraph Server["Market Data Bridge - Node.js"]
        MCP["MCP Server\nstdio + HTTP transport\nsrc/mcp/server.ts"]
        REST["REST API\nExpress + OpenAPI\nsrc/rest/server.ts"]
        WS["WebSocket Server\nsrc/ws/"]

        subgraph Core["Core Systems"]
            Config["Config & Logging\nsrc/config.ts"]
            Scheduler["Scheduler\nCron, Flatten, Reconcile\nsrc/scheduler.ts"]
            Orchestrator["Orchestrator\nsrc/orchestrator.ts"]
        end

        subgraph Data["Data Layer"]
            IBKR["IBKR Integration\nTWS/Gateway Socket\nsrc/ibkr/"]
            Yahoo["Yahoo Finance\nQuotes, History, Screeners\nsrc/providers/yahoo.ts"]
            DB["SQLite Database\nsrc/db/"]
        end

        subgraph Intelligence["Intelligence Layer"]
            Eval["Eval Engine\n30+ Features, 3 Models\nsrc/eval/"]
            Holly["Holly Trade Ideas\nCSV Alert Parsing\nsrc/holly/"]
            Risk["Risk Gate\nSession Guardrails\nsrc/ibkr/risk-gate.ts"]
        end

        subgraph Display["Display & Analytics"]
            Divoom["Divoom LED Display\nWidget Engine, Charts\nsrc/divoom/"]
            Ops["Ops Monitoring\nPrometheus, Health Checks\nsrc/ops/"]
        end
    end

    subgraph External["External Services"]
        TWS["Interactive Brokers\nTWS / Gateway"]
        YahooAPI["Yahoo Finance API"]
        ClaudeAPI["Anthropic Claude API"]
        OpenAI["OpenAI GPT API"]
        GeminiAPI["Google Gemini API"]
        Sentry["Sentry Error Tracking"]
    end

    subgraph Frontend["Frontend - Next.js 16"]
        Dashboard["Dashboard\nReact 19 + shadcn/ui"]
    end

    Claude -->|"MCP stdio"| MCP
    ChatGPT -->|"REST + OpenAPI"| REST
    Browser --> Dashboard
    Dashboard -->|"HTTP API"| REST
    Dashboard -->|"Real-time"| WS

    MCP --> Core
    REST --> Core
    Core --> Data
    Core --> Intelligence
    Core --> Display

    IBKR -->|"Socket"| TWS
    Yahoo --> YahooAPI
    Eval -->|"Claude"| ClaudeAPI
    Eval -->|"GPT"| OpenAI
    Eval -->|"Gemini"| GeminiAPI
    Ops --> Sentry
```

## Data Flow

Market data flows from Yahoo Finance and Interactive Brokers through a smart routing layer that selects the best available source, then fans out to consumers including MCP tools, the REST API, the eval engine, and the Divoom display.

```mermaid
flowchart LR
    subgraph Sources["Data Sources"]
        YahooAPI["Yahoo Finance API"]
        IBKRTWS["IBKR TWS/Gateway"]
        TradeIdeas["Trade Ideas CSV"]
    end

    subgraph Providers["Provider Layer"]
        YP["yahoo.ts\nQuotes, History,\nScreeners, Options"]
        IP["ibkr/marketdata.ts\nReal-time Ticks,\nSnapshots"]
        HP["holly/watcher.ts\nFile Polling"]
    end

    subgraph Routing["Smart Routing"]
        Router["get_quote Tool\nAuto-routes based on\nIBKR connection status"]
    end

    subgraph Storage["Persistence"]
        SQLite["SQLite DB\nOrders, Evals,\nJournal, Sessions"]
        EvStore["Event Store\nAppend-only Log"]
    end

    subgraph Consumers["Consumers"]
        MCPTool["MCP Tools\n56 tools"]
        RESTEnd["REST Endpoints"]
        EvalEng["Eval Engine\nFeature Extraction"]
        DivoomDisp["Divoom Display\nWidget Rendering"]
        WSFeed["WebSocket Feed\nReal-time Updates"]
    end

    YahooAPI --> YP
    IBKRTWS --> IP
    TradeIdeas --> HP

    YP --> Router
    IP --> Router

    Router --> MCPTool
    Router --> RESTEnd
    Router --> EvalEng
    Router --> DivoomDisp
    Router --> WSFeed

    HP --> SQLite
    MCPTool --> SQLite
    RESTEnd --> SQLite
    SQLite --> EvStore
```

## Eval Engine

The 3-model ensemble evaluation engine extracts 30+ technical features, sends them to Claude, GPT, and Gemini for scoring, then produces a weighted consensus with drift detection and Bayesian auto-recalibration.

```mermaid
flowchart TB
    subgraph Input["Evaluation Input"]
        Symbol["Symbol + Direction"]
        Quote["Live Quote Data"]
        History["Historical Bars"]
    end

    subgraph Guardrails["Pre-flight Guardrails"]
        Prefilter["prefilter.ts\nSpread, Volume,\nMarket Cap checks"]
    end

    subgraph Features["Feature Extraction - 30+"]
        direction LR
        Gap["Gap %"]
        RSI["RSI"]
        RVOL["Rel Volume"]
        ATR["ATR"]
        VWAP["VWAP"]
        Stoch["Stochastic"]
        VolRegime["Vol Regime"]
        MktAlign["Market Alignment"]
        OBI["Order Book\nImbalance"]
        TickVel["Tick Velocity"]
        FloatRot["Float Rotation"]
        Spread["Spread Quality"]
        More["... 18 more"]
    end

    subgraph Models["3-Model Ensemble"]
        direction LR
        ClaudeM["Claude\nclaude.ts"]
        GPTM["GPT\nopenai.ts"]
        GeminiM["Gemini\ngemini.ts"]
    end

    subgraph Scoring["Consensus Scoring"]
        Weights["Dynamic Weights\nweights.ts\nHot-reloadable"]
        Scorer["Ensemble Scorer\nscorer.ts"]
        Reasoning["Reasoning Extractor\nextractor.ts"]
    end

    subgraph Output["Output"]
        Score["Consensus Score\n1-10 with confidence"]
        Drift["Drift Detection\ndrift.ts"]
        Bayesian["Bayesian Updater\nAuto-recalibration"]
    end

    Symbol --> Prefilter
    Quote --> Prefilter
    History --> Prefilter

    Prefilter -->|"Pass"| Features
    Prefilter -->|"Reject"| Reject["Rejected\nwith reason"]

    Features --> ClaudeM
    Features --> GPTM
    Features --> GeminiM

    ClaudeM --> Scorer
    GPTM --> Scorer
    GeminiM --> Scorer
    Weights --> Scorer
    Scorer --> Reasoning

    Reasoning --> Score
    Score --> Drift
    Score --> Bayesian
    Bayesian -->|"Update"| Weights
```

## Order Execution

Orders flow through validation and risk gate checks before reaching IBKR TWS. The `place_advanced_bracket` tool handles the full lifecycle including parent fill, take-profit/stop-loss attachment, and session P&L tracking.

```mermaid
sequenceDiagram
    participant User as AI Client
    participant MCP as MCP Server
    participant Val as Validation Layer
    participant Risk as Risk Gate
    participant IBKR as IBKR Orders
    participant TWS as TWS/Gateway
    participant DB as SQLite DB

    User->>MCP: place_advanced_bracket(symbol, qty, entry, TP, SL)

    MCP->>Val: Validate order params
    Val->>Val: Check contract details
    Val->>Val: Verify order type & limits

    Val->>Risk: Check session state
    Risk->>Risk: Verify session unlocked
    Risk->>Risk: Check daily loss limit
    Risk->>Risk: Validate position size

    alt Session Locked
        Risk-->>MCP: Reject (session locked)
        MCP-->>User: Error - Session locked
    end

    Risk->>IBKR: Submit bracket order
    IBKR->>TWS: Place parent order
    TWS-->>IBKR: Order ID assigned
    IBKR->>DB: Record order

    TWS-->>IBKR: Parent FILLED
    IBKR->>TWS: Attach TP order (LMT)
    IBKR->>TWS: Attach SL order (STP)
    IBKR->>DB: Update fill record

    alt Take Profit Hit
        TWS-->>IBKR: TP FILLED
        IBKR->>DB: Record P&L
        IBKR->>Risk: Update session P&L
    else Stop Loss Hit
        TWS-->>IBKR: SL FILLED
        IBKR->>DB: Record P&L
        IBKR->>Risk: Update session P&L
    end

    IBKR-->>MCP: Order result
    MCP-->>User: Execution summary
```

## Key Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| MCP Server | `src/mcp/server.ts` | 56 tools for Claude Desktop/Code |
| REST API | `src/rest/server.ts` | Express + OpenAPI for ChatGPT |
| IBKR | `src/ibkr/` | TWS connection, orders, market data |
| Yahoo | `src/providers/yahoo.ts` | Quotes, screeners, fundamentals |
| Eval Engine | `src/eval/` | 3-model ensemble with 30+ features |
| Database | `src/db/` | SQLite persistence layer |
| Divoom | `src/divoom/` | LED display widget engine |
| Holly | `src/holly/` | Trade Ideas automation |
| Scheduler | `src/scheduler.ts` | Cron jobs, EOD flatten |
| Ops | `src/ops/` | Prometheus, health checks |
