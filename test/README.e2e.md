# E2E Smoke Tests

## Overview
End-to-end smoke tests that verify the bridge starts correctly and core API endpoints respond.

## Files
- `smoke-helpers.ts` - Helper functions for starting/stopping the bridge process
- `smoke.test.ts` - Smoke test suite

## Running Tests

### Prerequisites
1. Build the backend first:
```bash
npm run build
```

2. Run the smoke tests:
```bash
# Run all smoke tests
npx vitest run test/smoke.test.ts

# Or run with the e2e pattern (if directory structure is created)
npx vitest run test/e2e/smoke.test.ts
```

## Test Coverage

The smoke test suite verifies:

1. **Bridge Startup** - Bridge starts in REST-only mode without IBKR
2. **GET /api/status** - Returns 200 with status, time, and connection info
3. **POST /api/agent (get_status)** - Returns connection status via agent endpoint
4. **POST /api/agent (get_quote)** - Fetches AAPL quote from Yahoo Finance
5. **POST /api/agent (holly_stats)** - Returns Holly alerts statistics
6. **GET /api/agent/catalog** - Returns action metadata catalog
7. **POST /api/agent (unknown_action)** - Returns 400 error for invalid actions
8. **Cleanup** - Verifies no hanging processes after test completion

## Implementation Details

### Bridge Startup
- Spawns bridge with `--mode rest` flag
- Uses random port (30000-39999) to avoid conflicts
- Generates random API key for authentication
- Disables IBKR connection (port 99999)
- Sets LOG_LEVEL=error to minimize output

### Waiting for Ready
- Polls `/api/status` every 100ms
- 30-second timeout for startup
- Returns when `status: "ready"` is received

### Graceful Shutdown
- Sends SIGTERM for graceful shutdown
- 5-second timeout before force SIGKILL
- Cleans up resources properly

### Retry Logic
- HTTP requests retry 3 times with 500ms delay
- 5-second timeout per request
- Handles transient network failures

## Directory Structure Note

**Current Location**: Files are currently in `test/` directory
**Intended Location**: Files should be in `test/e2e/` subdirectory

To move files to the intended location:
```bash
mkdir -p test/e2e
mv test/smoke-helpers.ts test/e2e/helpers.ts
mv test/smoke.test.ts test/e2e/smoke.test.ts
```

Then update imports in `smoke.test.ts`:
```typescript
import { startBridge, waitForReady, stopBridge, retryFetch, type BridgeProcess } from "./helpers.js";
```

## Troubleshooting

### Tests Timeout
If tests timeout during startup:
- Ensure build/ directory exists (`npm run build`)
- Check that port range 30000-39999 is available
- Increase timeout in beforeAll() if needed

### Bridge Won't Start
- Verify Node.js version (18+)
- Check that all dependencies are installed
- Review stderr output captured in test failures

### Tests Hang
- Verify SIGTERM handler in src/index.ts
- Check for unhandled promises or event listeners
- Use `ps aux | grep node` to check for orphaned processes
