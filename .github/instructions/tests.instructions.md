---
applyTo: "**/*.test.ts"
---
# Test Standards (Vitest)

## Framework
- Vitest for all tests — `describe`/`it` pattern
- ESM imports with `.js` extensions for backend modules

## Database Tests
- Use in-memory better-sqlite3 (`':memory:'`) — never mock SQLite
- Create test helpers: `createTestDb()`, `insertTestData()`
- Clean up between tests

## Coverage Requirements
- Every new endpoint: unit test + edge case test + error test
- Feature modules: test with known inputs/outputs, test edge cases (zero, negative, empty arrays, division by zero)
- Model providers: test Zod validation with malformed responses

## Conventions
- No `console.log` in tests — use Vitest assertions only
- Test files: `src/{module}/__tests__/{name}.test.ts` or `test/{module}.test.ts`
- Named exports, no default exports
- Do not hardcode action counts (e.g., `toHaveLength(117)`) — use `toBeGreaterThanOrEqual()` for catalog tests

## Assertion Patterns
- Use `expect().toBe()` for primitives
- Use `expect().toEqual()` for objects/arrays
- Use `expect().toBeGreaterThanOrEqual()` for dynamic counts
- Use `expect().toThrow()` for error cases

## Before Writing Tests
1. Read the module under test — check every `export` for the actual public API
2. Read the types file — use actual interface/type names
3. Read one existing test in the same directory for patterns
4. Only then write tests
