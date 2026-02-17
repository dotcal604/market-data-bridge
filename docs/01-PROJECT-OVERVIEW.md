# Market Data Bridge — Project Overview

| Field | Value |
|---|---|
| **Project Name** | Market Data Bridge (`market-data-bridge`) |
| **Type** | Single-process trading assistant backend + dashboard |
| **Language** | TypeScript (Node.js backend), React/Next.js frontend |
| **Runtime** | Node.js 22+ |
| **Database** | SQLite (via better-sqlite3) |
| **Primary Interfaces** | MCP tools, REST API, WebSocket, Next.js dashboard |
| **Test Framework** | Vitest (1,079 tests across 55 files) |

---

## 1. Executive Summary

Market Data Bridge connects market data, IBKR trading workflows, a multi-model evaluation engine, and Trade Ideas Holly AI into one local system.

It supports:
- Real-time and historical market data (Yahoo + IBKR)
- Full order execution through IBKR (place, modify, cancel, bracket, flatten)
- A 3-model evaluation engine (Claude + GPT-4o + Gemini) with ensemble scoring
- Trade Ideas Holly AI alert integration with predictive analytics and exit optimization
- Session risk management with guardrails, position sizing, and automatic lockdown
- Edge analytics, drift detection, and walk-forward backtesting
- AI-to-AI collaboration channel
- Trade journaling, outcome tracking, and performance analytics
- Divoom Times Gate display for real-time trading dashboards
- A Next.js dashboard with 20+ pages

This is **assist-discretion mode**: the system scores and flags opportunities, while the human trader decides whether to place trades.

---

## 2. Core Capabilities

### Market data + execution
- Smart quote routing (IBKR real-time first, Yahoo fallback)
- Historical bars, options chain, option quotes, screener data
- Account summary, positions, PnL, order management, flatten controls
- Bracket orders with trailing stops, OCA groups, and adaptive algos
- Portfolio exposure analytics and beta-adjusted stress testing

### Eval engine (3-model ensemble)
- Shared feature pipeline including order book imbalance (WOBI/VPIN)
- Independent model calls with schema-validated outputs
- Weighted ensemble with disagreement penalty (k parameter)
- Auto-tune weights from outcome history using half-Kelly sizing
- Drift detection with rolling accuracy, calibration error, and regime-shift alerts

### Holly AI integration
- Import alerts and trades from Trade Ideas CSV exports
- File watcher for live alert ingestion during trading hours
- Auto-eval pipeline: incoming alerts scored through 3-model ensemble
- Predictor: learns strategy feature profiles, scans new symbols for matches
- Rule extraction: reverse-engineers trigger conditions using Cohen's d effect size
- Exit autopsy: MFE/MAE analysis, strategy archetypes, exit policy recommendations
- Trailing stop optimizer: 19 strategies tested against historical trade data

### Risk management
- Pre-trade risk gate with structural checks
- Session guardrails: daily loss limit, consecutive loss cooldown, trade count limits
- Position sizing from account equity, stop distance, and volatility regime
- Manual session lock/unlock/reset
- Configurable EOD auto-flatten scheduler

### Collaboration + journaling
- Shared channel between `claude`, `chatgpt`, and `user`
- Threaded messages, tags, filtering, and stats
- Trade journal with reasoning, setup types, confidence, and outcome tracking

---

## 3. Major Subsystems

| Subsystem | Purpose | Key Paths |
|---|---|---|
| MCP server | Tool interface for Claude and MCP clients | `src/mcp/server.ts` |
| REST API | HTTP interface + agent action dispatcher (120+ actions) | `src/rest/routes.ts`, `src/rest/agent.ts` |
| WebSocket | Real-time streaming for dashboard | `src/ws/server.ts` |
| Eval engine | Multi-model scoring + ensemble + drift | `src/eval/` |
| IBKR layer | Account, orders, market data, contracts, risk gate | `src/ibkr/` |
| Holly AI | Alert import, predictor, rule extraction, exit analysis | `src/holly/` |
| TraderSync | Trade history import and analysis | `src/tradersync/` |
| Collaboration | AI-to-AI messaging channel | `src/collab/store.ts` |
| Database | SQLite schema, event store, read models | `src/db/` |
| Divoom | Smart display integration | `src/divoom/` |
| Scheduler | Account snapshots, drift checks, flatten | `src/scheduler.ts` |
| Frontend | Next.js dashboard (20+ pages) | `frontend/src/` |

---

## 4. High-Level Structure

```
market-data-bridge/
├── src/                         # Backend TypeScript
│   ├── index.ts                 # Startup orchestration
│   ├── config.ts                # Environment configuration
│   ├── scheduler.ts             # Periodic tasks (snapshots, drift, flatten)
│   ├── mcp/server.ts            # MCP tool registration
│   ├── rest/                    # REST routes, agent dispatcher, GPT instructions
│   ├── ws/                      # WebSocket server + reconnection
│   ├── eval/                    # Features, providers, ensemble, drift, edge
│   ├── ibkr/                    # Connection, orders, market data, risk gate
│   ├── holly/                   # Alert import, watcher, predictor, backtester
│   ├── tradersync/              # TraderSync CSV import
│   ├── collab/                  # Collaboration channel store
│   ├── divoom/                  # Divoom display integration
│   └── db/                      # SQLite schema, event store, read models
├── frontend/                    # Next.js 14 dashboard (App Router)
│   └── src/app/                 # 20+ route pages
├── data/                        # Weights, runtime data files
├── docs/                        # Documentation (this file + 5 more)
├── scripts/                     # Utility scripts (API audit, etc.)
└── .github/workflows/           # CI: agent auto-merge, API audit
```

---

## 5. CI and Agent Workflow

The repo uses a multi-agent development workflow:

- **GitHub Copilot** — frontend pages, test suites, integrations
- **OpenAI Codex** — backend features, API actions, DB schemas
- **Claude Code** — architecture, review, merge management, documentation

Agent PRs from `copilot/*` and `codex/*` branches are auto-merged by `.github/workflows/agent-auto-merge.yml` if:
1. TypeScript type check passes (`tsc --noEmit`)
2. Full test suite passes (`vitest run`)
3. No merge conflicts with main

Failed PRs get a comment explaining what broke.

---

## 6. Stakeholders

| Role | Responsibility |
|---|---|
| Trader | Decision-maker; uses outputs to guide discretionary trades |
| System operator | Runs services, monitors IBKR connectivity, manages environment |
| AI assistants | Consume MCP/REST, collaborate, and summarize context |
| IBKR TWS/Gateway | Brokerage connectivity for account/order/market workflows |
| Trade Ideas Holly | External alert source for the auto-eval pipeline |
