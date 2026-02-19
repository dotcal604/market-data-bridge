# Analytics Jobs Implementation - PR Summary

## Overview
Implemented infrastructure for running Python analytics scripts from TypeScript with job tracking in SQLite.

## Changes Made

### 1. Database Schema (`src/db/schema.ts`)
Added `ANALYTICS_JOBS_SCHEMA_SQL` with:
- Table: `analytics_jobs` with 10 fields
- Indexes on: `script`, `status`, `created_at`
- Tracks: job execution history, exit codes, stdout/stderr, duration, timestamps

### 2. Database Integration (`src/db/database.ts`)
Added:
- Import of `ANALYTICS_JOBS_SCHEMA_SQL`
- Table creation via `db.exec(ANALYTICS_JOBS_SCHEMA_SQL)`
- Prepared statements: `insertAnalyticsJob`, `updateAnalyticsJob`, `queryAnalyticsJobs`, `getAnalyticsJobById`
- Helper functions with TypeScript interfaces
- Export interface: `AnalyticsJobRow`

### 3. Analytics Runner (`src/ops/analytics-runner.ts`)
New module with:
- **Whitelist validation**: Loads Python scripts from `analytics/` directory on startup
- **Script execution**: Spawns Python process via `child_process.spawn`
- **Timeout enforcement**: Default 5 minutes, kills zombies with SIGTERM → SIGKILL
- **Output capture**: Buffers stdout and stderr for DB storage
- **Job tracking**: Inserts job on start, updates on completion with status
- **Public API**:
  - `runAnalyticsScript(scriptName, args?, timeoutMs?, triggerType?)` → Promise<ScriptResult>
  - `getKnownScripts()` → string[]
  - `refreshKnownScripts()` → void

### 4. Tests (`src/__tests__/analytics-runner.test.ts`)
11 comprehensive tests covering:
- Script whitelist loading and validation
- Unknown script rejection
- Database CRUD operations
- Timeout handling with temp scripts
- stdout/stderr capture
- Exit code handling (success/error)
- Trigger type parameter
- All tests use in-memory database (`:memory:`)

### 5. Documentation (`ANALYTICS_RUNNER_NOTES.md`)
Comprehensive notes including:
- File location note (ops/ vs analytics/ directory)
- Implementation summary
- Safety features
- Usage examples
- Integration points
- Future enhancements

## Safety Features
1. ✅ Script whitelist prevents arbitrary command execution
2. ✅ Timeout kills runaway processes
3. ✅ Graceful termination (SIGTERM with SIGKILL fallback)
4. ✅ SQLite WAL mode allows concurrent Python reads
5. ✅ Structured logging via Pino with subsystem tag

## File Location Note
⚠️ Runner created at `src/ops/analytics-runner.ts` instead of `src/analytics/runner.ts` due to tooling limitation (create tool requires parent directory to exist). Functionally equivalent. Can be moved later with:
```bash
mkdir -p src/analytics
git mv src/ops/analytics-runner.ts src/analytics/runner.ts
# Update import in src/__tests__/analytics-runner.test.ts
```

## Verification Steps

### TypeScript Compilation
```bash
npx tsc --noEmit
```
Expected: No errors (tests excluded per tsconfig.json)

### Run Tests
```bash
npm test src/__tests__/analytics-runner.test.ts
```
Expected: 11 tests pass

### Manual Test
```typescript
import { runAnalyticsScript } from "./src/ops/analytics-runner.js";

const result = await runAnalyticsScript("recalibrate_weights");
console.log("Job ID:", result.jobId);
console.log("Exit code:", result.exitCode);
console.log("Duration:", result.durationMs, "ms");
```

## Known Python Scripts (11 total)
- agreement.py
- agreement_analysis.py
- calibration.py
- db_loader.py
- holly_rules.py
- markov_regime_model.py
- recalibrate_weights.py
- regime.py
- regime_accuracy.py
- tradersync_analytics.py
- vectorized_backtest.py

## Integration Ready For
1. **REST API**: Add `POST /api/analytics/jobs` endpoint
2. **MCP Tools**: Add `run_analytics_script` tool for Claude
3. **Scheduler**: Add periodic job triggers
4. **Frontend**: Job history viewer

## Dependencies
- ✅ No new runtime dependencies added
- ✅ Uses existing: better-sqlite3, pino, child_process (Node.js built-in)
- ✅ Tests use existing: vitest

## Breaking Changes
None. All additions are new functionality.

## Rollback Plan
If issues arise:
```bash
git revert <commit-hash>
```
This will:
- Remove analytics_jobs table (safe - no data loss from existing tables)
- Remove runner module (no existing code depends on it)
- Remove tests (no impact on existing test suite)
