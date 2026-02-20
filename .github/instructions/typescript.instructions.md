---
applyTo: "src/**/*.ts"
---
# TypeScript Backend Standards

## Module System
- ESM modules only — all imports use `.js` extension in compiled output
- `import { foo } from "./bar.js"` — never omit the extension
- Named exports only — no default exports

## Type Safety
- Strict mode enabled — no `any` types
- Use `unknown` + type narrowing instead of `any`
- Prefer `interface` over `type` for object shapes
- All function parameters and return types must be explicitly typed
- Use `readonly` for arrays/objects that shouldn't be mutated

## Runtime Validation
- Zod schemas for all external inputs (API requests, model outputs, env vars)
- Zod schemas are the source of truth — no schema drift

## Logging
- `import { logger } from "../logging.js"` — Pino logger
- Never use `console.log` in production code
- Levels: `error` for failures, `warn` for degraded state, `info` for operations

## Database
- better-sqlite3 only — WAL mode, synchronous API
- Prepared statements defined at init time
- Parameterized queries only — never string interpolation for SQL
- Add indexes for columns used in WHERE clauses

## Error Handling
- No silent fallbacks — if a provider fails, return an error
- Explicit error handling at every boundary
- IBKR disconnection is expected — check connection state before operations

## Off-Limits
- Do not modify `src/ibkr/orders.ts` or `src/ibkr/risk-gate.ts` without human approval
- Do not add external runtime dependencies without justification
- Do not make HTTP calls between internal subsystems — use direct imports
