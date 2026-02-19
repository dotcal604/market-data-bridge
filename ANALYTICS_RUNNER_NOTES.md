# Analytics Runner Implementation Notes

## File Location Note

The issue requirements specify creating `src/analytics/runner.ts`, however due to tooling limitations (create tool requires parent directory to exist, and no bash/mkdir access), the runner was created at:

**`src/ops/analytics-runner.ts`**

This is functionally equivalent and follows the existing codebase pattern where operational modules are placed in `src/ops/`. The module can be moved to `src/analytics/runner.ts` later if desired by:

```bash
mkdir -p src/analytics
git mv src/ops/analytics-runner.ts src/analytics/runner.ts
# Update imports in test file
```

## Implementation Summary

### Database Schema
- Added `analytics_jobs` table to `src/db/schema.ts` with fields:
  - `id`, `script`, `trigger_type`, `status`, `exit_code`, `stdout`, `stderr`, `duration_ms`, `created_at`, `completed_at`
- Added indexes on `script`, `status`, and `created_at` for query performance

### Database Helpers
Added to `src/db/database.ts`:
- `insertAnalyticsJob(script, triggerType)` - Returns job ID
- `updateAnalyticsJob(id, update)` - Updates status, exit code, outputs, duration
- `queryAnalyticsJobs(limit)` - Returns recent jobs ordered by created_at DESC
- `getAnalyticsJobById(id)` - Returns single job by ID
- `AnalyticsJobRow` interface for type safety

### Analytics Runner
Created `src/ops/analytics-runner.ts` with:
- **Script Whitelist**: Automatically loads Python scripts from `analytics/` directory on module initialization
- **`runAnalyticsScript(scriptName, args?, timeoutMs?, triggerType?)`**: Main function
  - Validates script against whitelist
  - Spawns Python process with `child_process.spawn`
  - Captures stdout and stderr streams
  - Enforces timeout (default 5 minutes)
  - Kills zombie processes on timeout (SIGTERM, then SIGKILL after 5s)
  - Records result to database with status: "success", "error", or "timeout"
- **`getKnownScripts()`**: Returns sorted array of available scripts
- **`refreshKnownScripts()`**: Reloads script whitelist from disk

### Tests
Created `src/__tests__/analytics-runner.test.ts` with 11 tests:
1. Script whitelist loading and sorting
2. Whitelist refresh functionality
3. Unknown script rejection
4. DB job insertion and retrieval roundtrip
5. DB job update functionality
6. Query recent jobs
7. Timeout handling (creates temp script that sleeps 10s, runs with 100ms timeout)
8. stdout/stderr capture
9. Success status with exit code 0
10. Error status with non-zero exit code
11. Trigger type parameter

### Safety Features
1. **Whitelist validation**: Only known scripts from `analytics/` can be executed
2. **Timeout enforcement**: Prevents runaway processes
3. **Graceful termination**: SIGTERM with SIGKILL fallback
4. **SQLite WAL mode**: Allows Python scripts to read DB concurrently with runner writes
5. **Structured logging**: All operations logged via Pino with subsystem: "analytics"

## Known Python Scripts (as of implementation)
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

(Excludes `__init__.py` which is a package marker)

## Usage Example

```typescript
import { runAnalyticsScript, getKnownScripts } from "./ops/analytics-runner.js";

// List available scripts
const scripts = getKnownScripts();
console.log("Available scripts:", scripts);

// Run a script
const result = await runAnalyticsScript("recalibrate_weights", [], 300_000, "manual");

if (result.exitCode === 0) {
  console.log("Script succeeded:", result.stdout);
} else if (result.timedOut) {
  console.log("Script timed out after", result.durationMs, "ms");
} else {
  console.log("Script failed with exit code", result.exitCode);
  console.log("stderr:", result.stderr);
}
```

## TypeScript Verification

Run `npx tsc --noEmit` from project root to verify compilation.

Expected: No errors (tests are excluded from compilation per tsconfig.json).

## Test Execution

Run tests with:
```bash
npm test src/__tests__/analytics-runner.test.ts
```

Or run all tests:
```bash
npm test
```

## Integration Points

The runner is ready to be integrated into:
1. **REST API endpoints** - Add endpoint to trigger analytics scripts via HTTP
2. **MCP tools** - Add MCP tool for Claude to run analytics
3. **Scheduler** - Schedule periodic runs of calibration/analysis scripts
4. **Admin UI** - Frontend dashboard to view job history and trigger runs

## Future Enhancements
1. Add REST endpoint: `POST /api/analytics/jobs` with `{ script, args }`
2. Add MCP tool: `run_analytics_script` for Claude integration
3. Add frontend page to view job history from `analytics_jobs` table
4. Add notification/webhook on job completion
5. Support Python virtualenv activation if needed
6. Add job cancellation endpoint (kill running process by job ID)
