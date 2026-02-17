# IBKR Market Bridge — Troubleshooting & Runbook

---

## 1. Diagnostic Quick Reference

### 1.1 Health Check Commands

```bash
# Is the REST server running?
curl http://localhost:3000/api/status

# Is TWS listening on the expected port?
netstat -ano | findstr :7496

# Is the bridge process alive?
tasklist | findstr node

# Can we reach the ngrok tunnel?
curl https://YOUR-NGROK-URL/api/status

# Quick data test
curl http://localhost:3000/api/quote/AAPL
```

### 1.2 Expected Healthy State

```json
// GET /api/status
{
  "connected": true,
  "host": "127.0.0.1",
  "port": 7496,
  "clientId": 0
}
```

```json
// GET /api/quote/AAPL (during market hours)
{
  "symbol": "AAPL",
  "bid": 275.50,
  "ask": 275.65,
  "last": 275.60,
  ...
}
```

---

## 2. Common Issues and Resolution

### 2.1 Connection Failures

#### ECONNREFUSED 127.0.0.1:7497 (or 7496)

| Item | Detail |
|---|---|
| **Symptom** | Bridge starts but logs `WARNING: Could not connect to TWS/Gateway` |
| **Root Cause** | TWS is not running, or the API port is incorrect |
| **Resolution** | 1. Verify TWS is open and logged in. 2. Check the port: **Edit > Global Configuration > API > Settings** — note the socket port. 3. Update `.env` with the correct port. 4. Restart the bridge. |
| **Verification** | `curl http://localhost:3000/api/status` returns `"connected": true` |

#### Connection Timed Out After 10 Seconds

| Item | Detail |
|---|---|
| **Symptom** | `Connection timed out after 10 seconds` in logs |
| **Root Cause** | TWS is rejecting the connection — typically a client ID conflict or TWS hasn't accepted the API connection yet |
| **Resolution** | 1. Check if another application uses the same `IBKR_CLIENT_ID`. Change to a unique value (1–31) in `.env`. 2. Check TWS for a popup asking to accept the API connection — click Accept. 3. Verify "Enable ActiveX and Socket Clients" is checked in TWS API settings. |

#### Repeated Disconnections

| Item | Detail |
|---|---|
| **Symptom** | Logs show alternating `Connected` and `Disconnected` messages |
| **Root Cause** | Another API client connected with the same `clientId`, causing TWS to drop the existing connection |
| **Resolution** | Assign a unique `IBKR_CLIENT_ID` in `.env` (each API connection must use a different ID, 0–31) |

---

### 2.2 Data Issues

#### All Quote Fields Are Null

| Item | Detail |
|---|---|
| **Symptom** | Quote returns but `bid`, `ask`, `last` are all `null` |
| **Possible Causes** | 1. Market is closed (after hours / weekend). `close` should still have a value. 2. No market data subscription for that exchange. 3. Paper account with no delayed data enabled. |
| **Resolution** | 1. Check if market is open. After hours, only `close` is populated. 2. In TWS: **Account > Settings > Paper Trading > Market Data** — enable delayed data. 3. For live accounts, verify market data subscriptions in IBKR Account Management. |

#### Historical Data Request Timed Out

| Item | Detail |
|---|---|
| **Symptom** | `Historical data request timed out for SYMBOL` |
| **Possible Causes** | 1. Invalid duration/bar_size combination. 2. TWS pacing violation (too many requests). 3. No historical data subscription. |
| **Resolution** | 1. Verify duration and bar_size are valid (see IBKR docs for allowed combinations). 2. Wait 10 seconds and retry — TWS imposes ~60 requests per 10 minutes. 3. Try a shorter duration or larger bar size. |

#### No Security Definition Found (Error 200)

| Item | Detail |
|---|---|
| **Symptom** | `Quote error for XYZ (200): No security definition has been found for the request` |
| **Root Cause** | The symbol doesn't exist, or the `secType`/`exchange`/`currency` combination is invalid |
| **Resolution** | 1. Use `search_contracts` or `GET /api/search?q=XYZ` to find the correct symbol. 2. For non-US stocks, specify the correct `exchange` and `currency`. |

#### Options Chain Returns Empty

| Item | Detail |
|---|---|
| **Symptom** | Options chain returns zero expirations and strikes |
| **Root Cause** | The underlying has no listed options, or the conId lookup failed |
| **Resolution** | 1. Verify the symbol has options (most large-cap US stocks do). 2. Run `get_contract_details` first to confirm the symbol resolves. |

---

### 2.3 REST / Network Issues

#### EADDRINUSE: Port 3000 Already in Use

| Item | Detail |
|---|---|
| **Symptom** | `Error: listen EADDRINUSE: address already in use :::3000` |
| **Root Cause** | Another process (or a previous bridge instance) is using port 3000 |
| **Resolution** | Find and kill the process: |

```powershell
# Windows: Find PID on port 3000
netstat -ano | findstr :3000
# Kill by PID
Stop-Process -Id <PID> -Force
```

```bash
# Linux/macOS: Find and kill
lsof -ti:3000 | xargs kill -9
```

Alternatively, change `REST_PORT` in `.env` to an unused port.

#### ChatGPT Can't Reach the API

| Item | Detail |
|---|---|
| **Symptom** | ChatGPT returns "could not connect" or "request timed out" when using actions |
| **Root Cause** | ngrok tunnel not running, URL changed, or server URL in GPT schema doesn't match |
| **Resolution** | 1. Verify ngrok is running: `curl https://YOUR-URL/api/status`. 2. If the URL changed, update the GPT's action schema with the new URL. 3. Verify the REST server is running: `curl http://localhost:3000/api/status`. |

#### CORS Errors in Browser

| Item | Detail |
|---|---|
| **Symptom** | Browser console shows `Access-Control-Allow-Origin` errors |
| **Root Cause** | Unlikely with current setup (CORS is enabled for all origins), but can occur behind certain proxies |
| **Resolution** | The bridge uses `cors()` middleware with no restrictions. Verify the request is reaching the bridge, not being blocked by a proxy or firewall. |

---

### 2.4 MCP / Claude Issues

#### MCP Tools Not Appearing in Claude Desktop

| Item | Detail |
|---|---|
| **Symptom** | No `ibkr` tools in Claude's tool picker |
| **Root Cause** | Config file not saved correctly, or Claude Desktop not restarted |
| **Resolution** | 1. Verify `claude_desktop_config.json` contains the `mcpServers.ibkr` key. 2. Verify the path to `build/index.js` is correct and uses forward slashes. 3. Fully quit and relaunch Claude Desktop (File > Quit, not just close window). 4. Check that `node build/index.js --mode mcp` runs without errors when executed manually. |

#### MCP Tool Calls Return Errors

| Item | Detail |
|---|---|
| **Symptom** | Claude invokes a tool but receives an error response |
| **Root Cause** | Usually a TWS connection issue — the MCP server started but can't reach TWS |
| **Resolution** | 1. Ensure TWS is running. 2. Check the stderr output of the MCP process for connection errors. 3. Use MCP Inspector to test: `npx @modelcontextprotocol/inspector node build/index.js --mode mcp` |

#### Claude Desktop Config Keeps Reverting

| Item | Detail |
|---|---|
| **Symptom** | The `mcpServers` block disappears from `claude_desktop_config.json` after editing |
| **Root Cause** | Claude Desktop may overwrite the config file when certain settings change in the UI |
| **Resolution** | 1. Close Claude Desktop before editing the config. 2. Alternatively, use Claude Code's CLI: `claude mcp add ibkr -- node "path/to/build/index.js" --mode mcp` |

---

## 3. TWS Error Code Reference

Common error codes emitted by TWS through the API:

| Code | Severity | Message | Meaning |
|---|---|---|---|
| 200 | Error | No security definition found | Invalid symbol or contract spec |
| 162 | Error | Historical data request pacing violation | Too many historical data requests; wait and retry |
| 354 | Error | Requested market data not subscribed | No market data subscription for this exchange |
| 10187 | Error | Failed to request delayed market data | Delayed data not available or not enabled |
| 2104 | Info | Market data farm connection is OK | Status message — safe to ignore |
| 2106 | Info | HMDS data farm connection is OK | Status message — safe to ignore |
| 2158 | Info | Sec-def data farm connection is OK | Status message — safe to ignore |
| 1100 | Warning | Connectivity lost | TWS lost connection to IBKR servers |
| 1102 | Info | Connectivity restored | TWS reconnected to IBKR servers |
| 504 | Error | Not connected | API socket not established |
| 502 | Error | Couldn't connect to TWS | TWS not running or API not enabled |

> **Note:** Codes 2104, 2106, 2158, and similar informational codes are filtered by `isNonFatalError()` and do not trigger error callbacks in the bridge.

---

## 4. Operational Procedures

### 4.1 Startup Procedure

1. Launch TWS or IB Gateway and log in
2. Wait for TWS to fully initialize (data farms connected)
3. Start the bridge:
   ```bash
   cd market-data-bridge
   node build/index.js --mode rest   # or --mode mcp, or no flag for both
   ```
4. Verify: `curl http://localhost:3000/api/status`
5. (If ChatGPT) Start ngrok: `ngrok http 3000`

### 4.2 Shutdown Procedure

1. Stop ngrok (Ctrl+C in ngrok terminal)
2. Stop the bridge (Ctrl+C in bridge terminal, or kill the process)
3. Optionally close TWS

The bridge handles SIGINT/SIGTERM gracefully — it disconnects from TWS before exiting.

### 4.3 Restart After TWS Disconnect

No manual action required. The bridge detects disconnection and retries every 5 seconds automatically. Once TWS is back, the bridge reconnects and tools resume working.

### 4.4 Updating the Code

```bash
# Pull changes (if using git)
git pull

# Rebuild
npm run build

# Restart the bridge
# (kill existing process first if running)
node build/index.js --mode rest
```

### 4.5 Changing TWS Port

1. Edit `.env` and update `IBKR_PORT`
2. Restart the bridge (no rebuild needed — config is loaded at runtime)

---

## 5. Monitoring and Observability

The bridge writes all diagnostic output to **stderr**. Key log patterns:

| Log Message | Meaning |
|---|---|
| `[IBKR Bridge] Starting in rest mode...` | Process startup |
| `[IBKR Bridge] Connected to TWS/Gateway` | Successful TWS connection |
| `[IBKR Bridge] WARNING: Could not connect` | TWS not reachable; auto-reconnect will try |
| `[IBKR] Disconnected from TWS/Gateway` | Lost connection (auto-reconnect starts) |
| `[IBKR] Attempting reconnect...` | Reconnect attempt in progress |
| `[IBKR] Error <code> (reqId=<id>): <msg>` | TWS error (non-fatal ones are filtered) |
| `[REST] Server listening on http://localhost:3000` | REST server ready |
| `[IBKR Bridge] MCP server running on stdio` | MCP server ready |
| `[IBKR Bridge] Shutting down...` | Graceful shutdown initiated |

### Log Collection

```bash
# Redirect stderr to a log file while keeping stdout for MCP
node build/index.js --mode rest 2> bridge.log

# Tail the log
tail -f bridge.log
```

---

## 6. Known Limitations

| Limitation | Impact | Workaround |
|---|---|---|
| No persistent URL (ngrok free) | ChatGPT GPT needs URL update on each ngrok restart | Use ngrok paid tier or Cloudflare Tunnel |
| No REST authentication | Anyone with network access to port 3000 can query account data | Only expose via authenticated tunnel; keep on localhost otherwise |
| Single account | Bridge reads the first account returned by TWS | For multi-account, would need code modification |
| WebSocket is dashboard-only | Real-time bars stream to the Next.js UI; MCP/REST use snapshots | Subscribe to real-time bars via API for streaming data |
| TWS rate limits | ~50 simultaneous mktdata, ~60 historical / 10 min | Space out requests; reduce bar count for historical |
| Paper account delayed data | 15–20 minute delay on quotes | Use live account for real-time, or accept delay for testing |
