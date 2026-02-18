# MCP Session Reliability Improvements

## Overview

This implementation adds session reliability features to prevent MCP connection breakage during bridge restarts and transient errors.

## Changes Made

### 1. Database Schema (src/db/database.ts)

Added `mcp_sessions` table to persist session metadata:

```sql
CREATE TABLE mcp_sessions (
  id TEXT PRIMARY KEY,
  transport TEXT NOT NULL,           -- "http" or "stdio"
  created_at TEXT NOT NULL,
  last_active TEXT NOT NULL,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT
);
```

**Prepared Statements:**
- `insertMcpSession` - Create new session record
- `updateMcpSessionActivity` - Update last_active timestamp and increment tool_calls
- `closeMcpSession` - Set closed_at timestamp
- `getActiveMcpSessions` - Query sessions where closed_at IS NULL
- `getMcpSessionStats` - Aggregate statistics (total, active, avg_duration, total_tool_calls)

**Helper Functions:**
- `insertMcpSession(sessionId, transport)` - Record session creation
- `updateMcpSessionActivity(sessionId)` - Track activity
- `closeMcpSession(sessionId)` - Mark session as closed
- `getActiveMcpSessions()` - Get list of open sessions
- `getMcpSessionStats()` - Get aggregate stats

### 2. MCP HTTP Session Keepalive (src/rest/server.ts)

**Session Recovery Logging:**
- On startup, logs count of sessions that were active before restart
- Informs operators that clients will need to reconnect
- Uses `logSessionRecovery()` function called in `createApp()`

**Keepalive Implementation:**
- SSE connections receive keepalive ping every 60 seconds
- Implemented via `setInterval()` per session
- Updates activity tracking in database via `updateMcpSessionActivity()`
- Intervals are cleaned up when session closes

**Session Lifecycle:**
- Session creation: persists to DB, starts keepalive interval
- Session activity: updates last_active timestamp, increments tool_calls
- Session closure: stops keepalive, sets closed_at timestamp
- Session expiry: 30-minute idle timeout (unchanged)

**Constants:**
```typescript
const SESSION_TTL_MS = 30 * 60 * 1000;        // 30 minutes idle timeout
const KEEPALIVE_INTERVAL_MS = 60 * 1000;      // 60 seconds keepalive ping
```

### 3. MCP Tool Error Handling (src/mcp/server.ts)

**Error Wrapper Function:**
```typescript
function withErrorHandling<T>(toolName: string, handler: ToolHandler<T>): ToolHandler<T>
```

Wraps tool handlers to:
- Catch unhandled exceptions
- Log errors with context (tool name, params, stack trace)
- Return structured MCP error response instead of crashing transport
- Prevent stdio transport corruption

**Logger Integration:**
- Added Pino logger import
- Logs tool errors to structured log with subsystem: "mcp"
- Includes tool name, parameters, error message, and stack trace

**Example Usage:**
```typescript
server.tool(
  "get_status",
  "Get bridge status...",
  {},
  withErrorHandling("get_status", async () => ({
    content: [{ type: "text", text: JSON.stringify(getStatus(), null, 2) }],
  }))
);
```

### 4. Stdio Transport Error Handlers (src/index.ts)

Added error event handlers for stdio transport:

```typescript
process.stdin.on("error", (err) => {
  logger.error({ err: err.message }, "MCP stdin error — attempting graceful shutdown");
  shutdown().catch(...);
});

process.stdout.on("error", (err) => {
  logger.error({ err: err.message }, "MCP stdout error — attempting graceful shutdown");
  shutdown().catch(...);
});
```

**Behavior:**
- Errors are logged with structured context
- Graceful shutdown is attempted (vs hard crash)
- Process lifecycle handlers (SIGINT/SIGTERM) handle cleanup

**Limitations:**
- Stdio transport cannot be recovered after bridge restart
- Claude Desktop must be restarted to re-establish stdio connection
- This is a fundamental limitation of stdio-based IPC

### 5. Ops Metrics Integration (src/ops/metrics.ts)

**Updated OpsMetrics Interface:**
```typescript
export interface OpsMetrics {
  // ... existing fields ...
  mcpSessions: {
    total: number;
    active: number;
    avgDurationSeconds: number | null;
    totalToolCalls: number;
  };
}
```

**Database Integration:**
- Imports `getMcpSessionStats()` from database module
- Calls it in `getMetrics()` to populate mcpSessions field
- Returns null for avgDurationSeconds when no sessions have closed

**Exposure:**
- Available via GET `/health/deep` endpoint
- Available via POST `/api/agent` action: `ops_health`
- Already integrated—no additional action registration needed

## Testing

### Unit Tests

**Database Tests (src/db/__tests__/mcp-sessions.test.ts):**
- Session insertion
- Activity updates (tool call incrementing)
- Session closure
- Active session filtering
- Statistics calculation
- Multi-transport support

**Metrics Tests (src/ops/__tests__/metrics.test.ts):**
- OpsMetrics interface shape validation
- Null avgDurationSeconds handling
- Zero sessions edge case

### Integration Testing

To test session recovery:
1. Start bridge: `npm start`
2. Create MCP session via POST `/mcp` with `Mcp-Session-Id` header
3. Check active sessions: `curl -H "X-API-Key: $API_KEY" http://localhost:3000/health/deep | jq .mcpSessions`
4. Restart bridge: `pm2 restart bridge`
5. Check logs for session recovery message
6. Verify session count: should show sessions were active before restart

To test keepalive:
1. Create MCP session via POST `/mcp`
2. Open SSE stream: GET `/mcp` with same session ID
3. Monitor DB: `SELECT * FROM mcp_sessions WHERE id = '<session-id>'`
4. Verify `last_active` updates every 60 seconds
5. Verify `tool_calls` increments with each tool invocation

## Client Reconnection Pattern

**For ChatGPT MCP Connector:**
- Reconnection is automatic if session ID is preserved
- ChatGPT maintains session ID across requests
- On 503/504 error, ChatGPT retries with exponential backoff
- Session will be recreated if expired (>30 min idle)

**For Claude Desktop (stdio):**
- Cannot reconnect after bridge restart (stdio limitation)
- Must restart Claude Desktop to re-establish stdio transport
- This is documented in CLAUDE.md

## Monitoring

### Health Endpoints

**GET /health** (unauthenticated):
```json
{
  "mcp_sessions": 3
}
```

**GET /health/deep** (unauthenticated):
```json
{
  "mcpSessions": {
    "total": 15,
    "active": 3,
    "avgDurationSeconds": 1847.5,
    "totalToolCalls": 423
  }
}
```

**POST /api/agent** (authenticated):
```json
{
  "action": "ops_health",
  "params": {}
}
```

Returns full OpsMetrics object including mcpSessions.

### Logs

Session lifecycle events are logged with context:

```
{"level":"info","time":"...","subsystem":"rest","sessionId":"abc123","total":3,"msg":"MCP session created"}
{"level":"info","time":"...","subsystem":"rest","count":2,"sessions":["abc123","def456"],"msg":"Session recovery: 2 sessions were active before restart — clients will need to reconnect"}
{"level":"info","time":"...","subsystem":"rest","sessionId":"abc123","total":2,"msg":"MCP session closed"}
{"level":"error","time":"...","subsystem":"mcp","tool":"get_quote","error":"Network timeout","msg":"MCP tool error"}
```

## Configuration

No new environment variables required. All features use existing config.

## Rollback Plan

If issues arise, sessions will continue to work (backward compatible). To disable features:

1. **Remove keepalive**: Comment out `keepaliveIntervals` code in `src/rest/server.ts`
2. **Remove DB tracking**: Comment out `insertMcpSession`/`updateMcpSessionActivity`/`closeMcpSession` calls
3. **Remove error wrapping**: Unwrap tool handlers (remove `withErrorHandling()`)

Database schema is additive—existing deployments will auto-create table on next startup.

## Future Enhancements

1. **MCP Session Resumption Protocol** (when spec is finalized)
   - Store session state in DB
   - Allow clients to resume after disconnect
   - Requires MCP SDK support

2. **Session Affinity for Load Balancing**
   - Use session ID to route to same process
   - Store session data in Redis for multi-instance deployments

3. **Client-Side Reconnection Library**
   - Auto-retry with exponential backoff
   - Session ID persistence across reconnects
   - Heartbeat monitoring

## References

- Issue: #XX (P0: MCP session reliability)
- MCP Specification: https://modelcontextprotocol.io/
- Express SSE: https://www.npmjs.com/package/express
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3
