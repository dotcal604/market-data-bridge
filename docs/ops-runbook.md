# Ops Runbook — Market Data Bridge

## Quick Reference Card

- **Local health checks**
  - `http://localhost:3000/health/ready`
  - `http://localhost:3000/health/deep`
- **Tunnel health check**
  - `https://api.klfh-dot-io.com/health/deep`
- **PM2 commands**
  - `pm2 status`
  - `pm2 restart market-bridge`
  - `pm2 logs market-bridge --lines 50`
- **Emergency flatten**
  - `curl -X POST localhost:3000/agent -H 'Content-Type: application/json' -d '{"action":"flatten_positions"}'`
- **Process model**
  - Runs as **`market-bridge`** via PM2
  - Mode: **both** (MCP + REST)
- **Logs**
  - `pm2 logs market-bridge --lines 200`
  - `~/.pm2/logs/`

---

## 1) Bridge Crash

### Symptoms
- PM2 shows `market-bridge` as stopped, errored, or repeatedly restarting.
- REST API calls fail with connection refused or timeout.
- MCP tools stop responding.

### Diagnosis steps
1. Check process state: `pm2 status`.
2. Inspect recent logs: `pm2 logs market-bridge --lines 100`.
3. Confirm port binding: `ss -ltnp | rg 3000`.
4. Verify health endpoint locally if process appears up: `curl -sS localhost:3000/health/ready`.

### Recovery steps
1. Restart service: `pm2 restart market-bridge`.
2. Re-check health: `curl -sS localhost:3000/health/deep`.
3. If restart loops continue, review crash stack traces in PM2 logs and roll back to last known-good release.
4. If trading risk is unknown, run emergency flatten.

### Prevention
- Keep PM2 process configured with restart policy and startup persistence.
- Add alerting on repeated PM2 restarts within a short interval.
- Validate builds before deploy (`npm run build`, `npm test`).

---

## 2) IBKR Disconnect

### Symptoms
- IBKR-dependent actions fail with not connected errors.
- Orders, account summary, or positions endpoints return connection errors.
- Ops metrics show reduced IBKR uptime percent.

### Diagnosis steps
1. Check IBKR connection state via API and ops health.
2. Verify TWS/Gateway is running and logged in.
3. Confirm host/port/clientId configuration values are unchanged.
4. Review logs for disconnect and reconnect attempts.

### Recovery steps
1. Restore TWS/Gateway session (login/unlock if needed).
2. Restart bridge to force reconnect if auto-reconnect fails: `pm2 restart market-bridge`.
3. Verify reconnect by querying account summary and positions.
4. Re-run critical checks before sending any new orders.

### Prevention
- Keep TWS/Gateway on stable host with auto-login workflow where policy permits.
- Monitor reconnect attempt count and alert on sustained disconnect.
- Schedule planned IBKR maintenance windows with operator notice.

---

## 3) Cloudflare Tunnel Down

### Symptoms
- External API URL (`api.klfh-dot-io.com`) is unreachable.
- Local health endpoints are healthy, but remote health fails.
- Operators can reach localhost but not public endpoint.

### Diagnosis steps
1. Check local health: `curl -sS localhost:3000/health/deep`.
2. Check tunnel health URL: `curl -sS https://api.klfh-dot-io.com/health/deep`.
3. Confirm tunnel daemon/process is running.
4. Review tunnel logs for authentication or route failures.

### Recovery steps
1. Restart tunnel service/process.
2. Validate DNS and tunnel route mapping to local port 3000.
3. Re-test external health endpoint.
4. Communicate temporary degraded external access while local service is healthy.

### Prevention
- Alert on tunnel health endpoint failures independent of local checks.
- Use supervised process management for tunnel service.
- Document credential rotation and expiry dates.

---

## 4) MCP Transport Broken

### Symptoms
- MCP clients cannot invoke tools, while REST may still be healthy.
- Agent integrations report transport/protocol errors.
- MCP-specific logs show stdio/handshake failures.

### Diagnosis steps
1. Check whether REST `/health/deep` remains healthy.
2. Inspect MCP-related logs from PM2 output.
3. Verify process mode is configured as `both`.
4. Confirm no stdout/stderr contamination in MCP transport path.

### Recovery steps
1. Restart service: `pm2 restart market-bridge`.
2. Reinitialize MCP client session.
3. Validate a simple MCP tool call and then a production action.
4. If still failing, route operations through REST temporarily.

### Prevention
- Include MCP transport health checks in synthetic monitoring.
- Keep MCP isolation mechanisms enabled in production.
- Validate MCP handshake in pre-release smoke tests.

---

## 5) High Error Rate

### Symptoms
- Elevated request failures from ops metrics.
- Spikes in 5xx responses or timeouts.
- Incident feed shows frequent operational events.

### Diagnosis steps
1. Check ops health and incidents actions for recent failures.
2. Inspect PM2 logs for repeated stack traces.
3. Identify whether failures cluster by subsystem (IBKR, Yahoo, DB, MCP).
4. Confirm upstream dependencies are reachable and within limits.

### Recovery steps
1. Mitigate immediate pressure (reduce request load/retry storms).
2. Restart bridge if error state is persistent: `pm2 restart market-bridge`.
3. Disable non-critical workflows temporarily if they amplify failures.
4. Verify error rate returns to baseline before restoring full traffic.

### Prevention
- Set SLO alerts on error-rate and latency thresholds.
- Add circuit-breaker/backoff behavior at integration boundaries.
- Perform post-incident root cause analysis and add regression tests.

---

## 6) Memory Leak / Memory Pressure

### Symptoms
- PM2 restarts due to memory limits.
- Increasing RSS/heap over time without recovery.
- Latency degradation preceding OOM events.

### Diagnosis steps
1. Check PM2 process memory trend (`pm2 status`).
2. Review ops memory metrics and recent incidents.
3. Correlate memory growth with specific workloads/endpoints.
4. Inspect logs for GC pressure, OOM, or repeated large payload handling.

### Recovery steps
1. Restart process to reclaim memory: `pm2 restart market-bridge`.
2. Temporarily reduce high-volume operations.
3. If active risk exists, flatten positions before extended maintenance.
4. Capture diagnostics and isolate leaking code path for patch.

### Prevention
- Add memory trend alerts and leak detection in soak tests.
- Bound in-memory buffers/caches and enforce payload size limits.
- Periodically review long-lived subscriptions and cleanup logic.

---

## 7) TWS Restart / Session Reset

### Symptoms
- IBKR disconnects during market hours.
- Orders/positions temporarily unavailable after TWS restart.
- Reconnect attempts increase sharply.

### Diagnosis steps
1. Confirm whether TWS/Gateway restarted (manual, crash, update).
2. Check bridge reconnect status and last disconnect reason.
3. Validate account and market data permissions after login.
4. Confirm time sync and API settings in TWS are intact.

### Recovery steps
1. Complete TWS login and unlock prompts.
2. Restart bridge if reconnect does not stabilize quickly.
3. Validate `get_account_summary`, `get_positions`, and quote actions.
4. Resume operations only after IBKR state is healthy.

### Prevention
- Schedule TWS updates/restarts outside trading window.
- Keep TWS API settings documented and version-controlled where possible.
- Alert on unexpected midday TWS restart events.

---

## 8) Database Corruption / SQLite Issues

### Symptoms
- Queries fail with SQLite errors (malformed DB, disk I/O, locked state anomalies).
- Write operations fail consistently.
- Startup may fail during DB initialization.

### Diagnosis steps
1. Review logs for specific SQLite error messages.
2. Check filesystem free space and disk health.
3. Verify DB file permissions and ownership.
4. Run integrity check on a maintenance copy when possible.

### Recovery steps
1. Stop writes and preserve current DB artifacts.
2. Restore from latest known-good backup if corruption confirmed.
3. Restart service and validate core reads/writes.
4. Reconcile critical operational records after restore.

### Prevention
- Maintain scheduled backups with restore drills.
- Keep WAL mode enabled and avoid unsafe shutdowns.
- Monitor disk space and I/O errors proactively.
