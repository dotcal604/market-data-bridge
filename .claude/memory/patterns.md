# Code Patterns & Conventions

## Backend
- Pino structured logging (never console.log — stdout suppressed for MCP stdio)
- Zod schemas on all inputs (REST, MCP, DB)
- Named exports only (no defaults)
- Prepared SQL statements compiled at startup
- In-memory SQLite (`:memory:`) for test isolation
- Config via `src/config.ts` with env var validation at boot

## Frontend
- Next.js 16 App Router, React 19, Tailwind v4
- "use client" directive on interactive components
- Zustand for UI state, React Query for data fetching
- shadcn/ui + Radix primitives, Recharts for charts
- Dark theme mandatory

## Testing
- Vitest 4.0, supertest for HTTP
- Tests colocated in `__tests__/` directories
- No mocking of database — use in-memory SQLite
- Coverage via `vitest --coverage` (v8)

## Risk Calculations
- Gap %: (Price - PriorClose) / PriorClose × 100
- RVOL: CurrentVolume / averageVolume
- Spread %: (Ask - Bid) / Last × 100 (flag >0.50%)
- Small cap: <$300M market cap (flag unless user requests)

## Ensemble Scoring
- weighted_score = Σ(model_score × weight) / Σ(weights)
- disagreement_penalty = k × (score_spread²) / 10000
- final = weighted_score - penalty
- should_trade = score ≥ 40 AND majority vote
