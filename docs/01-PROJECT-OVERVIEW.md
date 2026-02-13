# IBKR Market Bridge — Project Overview

| Field | Value |
|---|---|
| **Project Name** | Market Data Bridge (`market-data-bridge`) |
| **Type** | Single-process trading assistant backend + dashboard |
| **Language** | TypeScript (Node.js backend), React/Next.js frontend |
| **Runtime** | Node.js 18+ |
| **Primary Interfaces** | MCP tools, REST API, Next.js dashboard |

---

## 1. Executive Summary

Market Data Bridge connects market data, IBKR trading workflows, and a multi-model evaluation engine into one local system.

It supports:
- Real-time and historical market data (Yahoo + IBKR)
- Manual trader execution workflows through IBKR order endpoints/tools
- A 3-model evaluation engine (Claude + GPT + Gemini) with ensemble scoring
- AI-to-AI collaboration channel
- Trade journaling, outcome tracking, and analytics-friendly exports
- A Next.js dashboard for reviewing evaluations, outcomes, and weight history

This is **assist-discretion mode**: the system scores and flags opportunities, while the human trader decides whether to place trades.

---

## 2. Core Capabilities

### Market data + execution
- Smart quote routing (IBKR first, Yahoo fallback)
- Historical bars, options chain, option quotes, screener data
- Account summary, positions, PnL, order management, flatten controls

### Eval engine (3-model ensemble)
- Shared feature pipeline for all models
- Independent model calls with schema-validated outputs
- Weighted ensemble with disagreement penalty
- Guardrails for timing, behavior, and session risk controls

### Collaboration channel
- Shared channel between `claude`, `chatgpt`, and `user`
- Threaded messages, tags, filtering, and stats
- Operational handoff for analysis and review workflows

### Trade journal + outcomes
- Journal entries for pre/post-trade reasoning
- Historical order/execution views from SQLite
- Eval outcomes and reasoning retrieval for review and model tuning

---

## 3. Risk and Safety Components

### Risk gate
- Pre-trade structural checks before order placement
- Session-level controls: lock/unlock, cooldown/loss tracking, manual reset

### Flatten scheduler
- Configurable end-of-day flatten behavior
- Manual flatten endpoint/tool for immediate position close-out

### Position sizing
- Read-only sizing calculator based on account/risk constraints
- Inputs include entry, stop, and optional risk/capital caps

### Portfolio analytics
- Exposure analytics (gross/net/beta/sector/heat)
- Stress testing with optional beta-adjusted shocks

---

## 4. Major Subsystems

| Subsystem | Purpose | Key Paths |
|---|---|---|
| MCP server | 56-tool interface for Claude and other MCP clients | `src/mcp/server.ts` |
| REST API | HTTP interface for apps, actions, and automation | `src/rest/routes.ts`, `src/rest/server.ts` |
| Eval engine | Multi-model scoring + ensemble + drift support | `src/eval/` |
| IBKR layer | Account, orders, market data, contracts, risk checks | `src/ibkr/` |
| Collaboration store | AI-to-AI messaging | `src/collab/store.ts` |
| Database layer | SQLite schema and prepared query helpers | `src/db/database.ts` |
| Frontend dashboard | Eval/history/weights UI in Next.js | `frontend/src/` |

---

## 5. High-Level Structure

```
market-data-bridge/
├── src/                     # Backend TypeScript
│   ├── index.ts             # Startup orchestration
│   ├── mcp/server.ts        # 56 MCP tools
│   ├── rest/routes.ts       # REST endpoints
│   ├── eval/                # Features, model providers, ensemble, guardrails
│   ├── ibkr/                # Execution + account + risk modules
│   ├── db/                  # SQLite schema/queries
│   └── collab/              # Collaboration channel store
├── frontend/                # Next.js dashboard (App Router)
├── data/                    # Weights, runtime data files
└── docs/                    # Documentation set
```

---

## 6. Stakeholders

| Role | Responsibility |
|---|---|
| Trader | Decision-maker; uses outputs to guide discretionary trades |
| System operator | Runs services, monitors IBKR connectivity, manages environment |
| AI assistants | Consume MCP/REST, collaborate, and summarize context |
| IBKR TWS/Gateway | Brokerage connectivity for account/order/market workflows |
