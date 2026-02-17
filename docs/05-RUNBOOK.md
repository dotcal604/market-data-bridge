# IBKR Market Bridge — Troubleshooting & Runbook

---

## 0. Emergency Quick Reference

| What | Command |
|------|---------|
| **Health (local)** | `curl http://localhost:3000/health/ready` |
| **Health (full)** | `curl http://localhost:3000/health/deep` |
| **Health (tunnel)** | `curl https://api.klfh-dot-io.com/health/deep` |
| **pm2 status** | `pm2 status` |
| **pm2 restart** | `pm2 restart market-bridge` |
| **pm2 logs** | `pm2 logs market-bridge --lines 50` |
| **Flatten all** | `curl -X POST localhost:3000/agent -H "Content-Type: application/json" -d "{\"action\":\"flatten_positions\"}"` |
| **Process info** | Runs as `market-bridge` via pm2, `--mode both` (MCP+REST) |
| **Tunnel** | Cloudflare: `api.klfh-dot-io.com` → `localhost:3000` |
| **Logs** | `~/.pm2/logs/market-bridge-*.log` |

---

## 1. Diagnostic Quick Reference

### 1.1 Health Check Commands

```bash
# Readiness probe (returns 503 until fully initialized)
curl http://localhost:3000/health/ready

# Full ops dashboard (metrics, IBKR SLA, incidents)
curl http://localhost:3000/health/deep

# Via Cloudflare tunnel
curl https://api.klfh-dot-io.com/health/deep

# Is TWS listening on the expected port?
netstat -ano | findstr :7496

# pm2 process status
pm2 status

# Recent logs
pm2 logs market-bridge --lines 50
```

### 1.2 Expected Healthy State

```json
// GET /health/ready
{
  "ready": true,
  "db_writable": true,
  "ibkr_connected": true,
  "rest_server": true
}
```

```json
// GET /health/deep (key fields)
{
  "ibkrConnected": true,
  "ibkrUptimePercent": 99.7,
  "ibkrDisconnects": 0,
  "incidentCount": 0,
  "memoryMb": { "rss": 80 },
  "cpuPercent": 0,
  "requests": { "errorRate": 0 }
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
| **Root Cause** | Cloudflare tunnel not running, tunnel crashed, or server URL in GPT schema doesn't match |
| **Resolution** | 1. Verify tunnel is running: `curl https://api.klfh-dot-io.com/health`. 2. Check tunnel status: `sc query cloudflared` (Windows) or `systemctl status cloudflared` (Linux). 3. Restart tunnel if needed: `sc start cloudflared` or `systemctl restart cloudflared`. 4. Verify the REST server is running: `curl http://localhost:3000/api/status`. 5. Check tunnel health in `/health/deep` endpoint for auto-restart status. |

#### Cloudflare Tunnel Down or Degraded

| Item | Detail |
|---|---|
| **Symptom** | External connectivity lost but local server responds; ChatGPT gets timeouts |
| **Root Cause** | cloudflared service crashed, network issues, or tunnel configuration invalid |
| **Resolution** | 1. Check tunnel metrics: `curl http://localhost:3000/health/deep` — look for `tunnelConnected` and `tunnelConsecutiveFailures`. 2. Restart tunnel service: Windows: `sc stop cloudflared && sc start cloudflared`; Linux: `systemctl restart cloudflared`. 3. Check cloudflared logs: Windows Event Viewer or `journalctl -u cloudflared -n 50` (Linux). 4. If auto-restart failed 3 times, check incident log in `/api/agent` with action `ops_incidents`. 5. Verify tunnel URL in `.env` matches public URL. |

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
3. Verify Cloudflare tunnel is running:
   ```bash
   # Windows
   sc query cloudflared
   # Linux
   systemctl status cloudflared
   ```
   If not running, start it: `sc start cloudflared` (Windows) or `systemctl start cloudflared` (Linux)
4. Start the bridge:
   ```bash
   cd market-data-bridge
   node build/index.js --mode rest   # or --mode mcp, or no flag for both
   ```
5. Verify local: `curl http://localhost:3000/api/status`
6. Verify tunnel: `curl https://api.klfh-dot-io.com/health`

### 4.2 Shutdown Procedure

1. Stop the bridge (Ctrl+C in bridge terminal, or kill the process)
2. Optionally stop cloudflared: `sc stop cloudflared` (Windows) or `systemctl stop cloudflared` (Linux)
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

### 4.5 Cloudflare Tunnel Operations

#### Tunnel Setup (One-Time)

1. **Install cloudflared:**
   - Windows: `winget install cloudflare.cloudflared`
   - Linux: Download from https://github.com/cloudflare/cloudflared/releases
   - macOS: `brew install cloudflared`

2. **Authenticate:**
   ```bash
   cloudflared tunnel login
   ```
   This opens a browser to authenticate with Cloudflare and creates a certificate.

3. **Create tunnel:**
   ```bash
   cloudflared tunnel create market-data-bridge
   ```
   Note the tunnel ID from the output.

4. **Configure tunnel:**
   Create `~/.cloudflared/config.yml` (Windows: `%USERPROFILE%\.cloudflared\config.yml`):
   ```yaml
   tunnel: <TUNNEL_ID>
   credentials-file: /path/to/.cloudflared/<TUNNEL_ID>.json
   
   ingress:
     - hostname: api.klfh-dot-io.com
       service: http://localhost:3000
     - service: http_status:404
   ```

5. **Add DNS record:**
   ```bash
   cloudflared tunnel route dns market-data-bridge api.klfh-dot-io.com
   ```

6. **Install as service:**
   - Windows: `cloudflared service install`
   - Linux: `sudo cloudflared service install`

7. **Start service:**
   - Windows: `sc start cloudflared`
   - Linux: `sudo systemctl start cloudflared && sudo systemctl enable cloudflared`

#### Tunnel Health Check

```bash
# Check if tunnel is up (external)
curl https://api.klfh-dot-io.com/health

# Check tunnel status (local)
curl http://localhost:3000/health/deep | jq '.tunnelConnected, .tunnelUptimePercent'

# Check service status
# Windows
sc query cloudflared

# Linux
systemctl status cloudflared
```

#### Restart Tunnel

```bash
# Windows
sc stop cloudflared
sc start cloudflared

# Linux
sudo systemctl restart cloudflared

# Verify restart worked
curl https://api.klfh-dot-io.com/health
```

#### Update cloudflared

**IMPORTANT:** Update regularly for security patches and stability improvements.

```bash
# Windows (recommended: use winget)
winget upgrade cloudflare.cloudflared

# Or manually download and replace
# 1. Download latest from https://github.com/cloudflare/cloudflared/releases
# 2. Stop service: sc stop cloudflared
# 3. Replace cloudflared.exe
# 4. Start service: sc start cloudflared

# Linux
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo systemctl stop cloudflared
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
sudo systemctl start cloudflared

# Verify version
cloudflared version
```

#### Tunnel Monitoring

The bridge automatically monitors tunnel health every 5 minutes:
- Probes `https://api.klfh-dot-io.com/health`
- Tracks uptime % separately from process uptime
- Records latency for each probe
- Auto-restarts after 3 consecutive failures
- Records failures as incidents

**View tunnel metrics:**
```bash
# Full metrics
curl http://localhost:3000/health/deep | jq '.tunnelUptimePercent, .tunnelLastProbeLatencyMs, .tunnelConsecutiveFailures'

# Via agent API
curl -X POST http://localhost:3000/api/agent \
  -H "X-API-Key: $REST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "ops_uptime"}'
```

**Incident history:**
```bash
curl -X POST http://localhost:3000/api/agent \
  -H "X-API-Key: $REST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "ops_incidents", "params": {"limit": 20}}'
```

#### Known Failure Modes

| Scenario | Detection | Auto-Recovery | Manual Recovery |
|---|---|---|---|
| cloudflared crash | 3 failed probes in 15 min | Service restart attempted | `sc start cloudflared` |
| Network partition | Probe timeout | Restart after threshold | Check network, restart if needed |
| Certificate expiry | HTTP 401/403 from tunnel | None | Re-run `cloudflared tunnel login` |
| DNS misconfiguration | Probe DNS error | None | Check DNS records in Cloudflare dashboard |
| Port conflict (3000) | Bridge won't start | None | Kill process on port 3000, restart bridge |
| Cloudflare outage | Probe timeouts | None (external issue) | Wait for Cloudflare, or use direct connection |

#### Troubleshooting Tunnel Issues

1. **Tunnel shows as "connected" but probes fail:**
   - Check if bridge is listening: `netstat -ano | findstr :3000`
   - Check if tunnel is routing correctly: `cloudflared tunnel info market-data-bridge`
   - Check ingress config in `~/.cloudflared/config.yml`

2. **Auto-restart not working:**
   - Check service manager is accessible: `sc query cloudflared` (Windows) or `systemctl list-units` (Linux)
   - Check bridge logs for restart attempt messages
   - Verify bridge has permission to run `sc` or `systemctl` commands

3. **Tunnel frequently disconnects:**
   - Update cloudflared to latest version
   - Check for network stability issues
   - Increase tunnel probe interval (default: 5 min) via `TUNNEL_CHECK_MS` env var
   - Check cloudflared logs for errors: `journalctl -u cloudflared -n 100` (Linux)

4. **High tunnel latency (>500ms):**
   - Normal baseline: 50-150ms for healthy tunnel
   - Check local network latency: `ping 1.1.1.1`
   - Check Cloudflare status: https://www.cloudflarestatus.com/
   - Consider using a closer Cloudflare datacenter (check tunnel routing)

### 4.6 Changing TWS Port

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
| No REST authentication | Anyone with network access to port 3000 can query account data | Only expose via authenticated tunnel; keep on localhost otherwise; use API key via `REST_API_KEY` env var |
| Single account | Bridge reads the first account returned by TWS | For multi-account, would need code modification |
| WebSocket is dashboard-only | Real-time bars stream to the Next.js UI; MCP/REST use snapshots | Subscribe to real-time bars via API for streaming data |
| TWS rate limits | ~50 simultaneous mktdata, ~60 historical / 10 min | Space out requests; reduce bar count for historical |
| Paper account delayed data | 15–20 minute delay on quotes | Use live account for real-time, or accept delay for testing |
| Tunnel auto-restart privilege | Windows service restart may require admin | Run cloudflared service with admin privileges, or restart manually |
