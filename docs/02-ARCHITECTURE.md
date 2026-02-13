# IBKR Market Bridge — Architecture & Design

## 1) System context

```
AI clients (MCP/REST) ──► Node.js single process (port 3000) ──► IBKR TWS/Gateway
                               │
                               ├── SQLite (better-sqlite3)
                               ├── Eval engine (3-model ensemble)
                               ├── Collaboration channel store
                               └── Frontend dashboard proxy target

Next.js dashboard (dev :3001) ──► /api/* proxied to backend :3000
```

The backend is intentionally single-process and single-port for operational simplicity.
Subsystems communicate via direct imports/function calls (no internal HTTP hop design).

---

## 2) Layered architecture

| Layer | Responsibility | Main paths |
|---|---|---|
| Interface | MCP tools + REST routes + OpenAPI | `src/mcp/`, `src/rest/` |
| Domain / services | Market data, orders, risk checks, eval orchestration | `src/providers/`, `src/ibkr/`, `src/eval/` |
| Data | SQLite schema + prepared statements + reconciliation | `src/db/` |
| Presentation | Dashboard pages and components | `frontend/src/` |
| Analytics/offline | Weight tuning and analysis scripts | `scripts/` (Python-based workflow) |

---

## 3) Eval layer (3-model ensemble)

The evaluation pipeline lives in `src/eval/` and has five stages:

1. **Feature computation** (`features/`)
   - Deterministic calculations (RVOL, VWAP deviation, ATR, gap, spread, etc.)
   - No side effects in feature modules
2. **Model execution** (`models/`)
   - Claude, OpenAI, and Gemini providers run in parallel
   - Temperature fixed to 0, outputs validated by Zod
3. **Ensemble scoring** (`ensemble/`)
   - Weighted mean + quadratic disagreement penalty
   - Weights loaded from `data/weights.json` with hot reload support
4. **Guardrails** (`guardrails/`)
   - Structural prefilters and post-score behavioral/session checks
5. **Persistence + review**
   - Evaluations, model outputs, outcomes, and reasoning available for audit

This design keeps model calls independent (ceteris paribus), then combines outputs in a transparent scoring layer.

---

## 4) Execution and risk architecture

| Component | Purpose |
|---|---|
| `src/ibkr/orders.ts` | Order placement/cancel/flatten and advanced order strategies |
| `src/ibkr/risk-gate.ts` | Session state, lock/cooldown/loss limits, pre-trade checks |
| `src/ibkr/risk.ts` | Position sizing utility |
| `src/scheduler.ts` | Automated flatten scheduler controls |
| `src/ibkr/portfolio.ts` | Stress tests and exposure analytics |

### Safety model
- Human remains final decision-maker.
- Risk checks execute before order placement endpoints/tools.
- Session controls allow manual lock/reset and loss-streak enforcement.

---

## 5) Collaboration and journaling

- Collaboration channel (`src/collab/store.ts`) supports message posting, filtering, and stats.
- Journal/history endpoints read from SQLite (`src/db/database.ts`) for trade review workflows.
- Eval outcome tracking links model decisions to realized trade outcomes.

---

## 6) Frontend dashboard architecture

The dashboard (Next.js App Router) is in `frontend/` and consumes backend APIs through typed client hooks.

Key points:
- React Query for polling/cache lifecycle
- TanStack Table for eval history and sorting/filtering
- Recharts for analytics visualizations
- Zustand for local UI filter state

Main UX surfaces:
- Dashboard overview metrics
- Evaluation history and detail pages
- Ensemble weight views
- Model-comparison and analytics components

---

## 7) Analytics scripts (Python)

Offline analytics workflows are used for:
- Weight recalibration after sufficient labeled outcomes
- Drift analysis support
- Export-driven research loops

These scripts are intentionally offline so production scoring remains deterministic and fast during trading sessions.

---

## 8) Data and persistence

- `better-sqlite3` is the persistence engine (WAL mode)
- Prepared statements are created at startup for performance/safety
- Core tables include evaluations, model outputs, outcomes, orders, executions, and journal records
