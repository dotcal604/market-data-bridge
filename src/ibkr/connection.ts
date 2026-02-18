import { IBApi, EventName, ErrorCode, isNonFatalError } from "@stoqey/ib";
import { config } from "../config.js";
import { recordIncident } from "../ops/metrics.js";

let ib: IBApi | null = null;
let connected = false;
let nextReqId = 1;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const RECONNECT_BASE_MS = 2_000;     // start at 2s (was 5s)
const RECONNECT_MAX_MS = 30_000;     // cap at 30s (was 5 min — too slow)
let twsVersion: number | null = null;

// ── Connection metrics & history ─────────────────────────────────────
interface ConnectionEvent {
  type: "connected" | "disconnected" | "error_326" | "reconnect_attempt" | "tws_restart";
  timestamp: string;
  clientId?: number;
  detail?: string;
}

const MAX_HISTORY = 50;
const connectionHistory: ConnectionEvent[] = [];
let totalDisconnects = 0;
let lastConnectedAt: string | null = null;
let lastDisconnectedAt: string | null = null;
let disconnectedAtMs: number | null = null; // for reconnect duration tracking
let lastReconnectDurationMs: number | null = null;

function pushEvent(evt: ConnectionEvent): void {
  connectionHistory.push(evt);
  if (connectionHistory.length > MAX_HISTORY) {
    connectionHistory.splice(0, connectionHistory.length - MAX_HISTORY);
  }
}

// ── Heartbeat / keepalive (3-strike system) ──────────────────────────
const HEARTBEAT_INTERVAL_MS = 60_000;  // ping TWS every 60s
const HEARTBEAT_TIMEOUT_MS = 10_000;   // per-strike timeout
const HEARTBEAT_JITTER_MS = 2_000;     // ±2s jitter on interval
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatMisses = 0;
let heartbeatLatencies: number[] = [];  // rolling window for p95 computation
const MAX_HB_LATENCIES = 60;           // keep last 60 readings (~1 hour)

function jitteredHeartbeatInterval(): number {
  return HEARTBEAT_INTERVAL_MS + Math.round((Math.random() * 2 - 1) * HEARTBEAT_JITTER_MS);
}

function scheduleNextHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setTimeout(() => {
    heartbeatTimer = null;
    runHeartbeat();
    if (connected) scheduleNextHeartbeat();
  }, jitteredHeartbeatInterval());
}

function runHeartbeat(): void {
  if (!connected || !ib) return;
  let responded = false;
  const sentAt = Date.now();
  const onTime = () => {
    responded = true;
    const latency = Date.now() - sentAt;
    heartbeatLatencies.push(latency);
    if (heartbeatLatencies.length > MAX_HB_LATENCIES) heartbeatLatencies.shift();
    if (heartbeatMisses > 0) {
      console.error(`[IBKR] Heartbeat recovered after ${heartbeatMisses} miss(es) (latency=${latency}ms)`);
    }
    heartbeatMisses = 0;
  };
  ib.on(EventName.currentTime, onTime);
  ib.reqCurrentTime();
  setTimeout(() => {
    ib?.off(EventName.currentTime, onTime);
    if (!responded && connected) {
      heartbeatMisses++;
      if (heartbeatMisses === 1) {
        // Strike 1: warning
        console.error(`[IBKR] Heartbeat miss #1 — TWS slow (timeout=${HEARTBEAT_TIMEOUT_MS}ms)`);
        recordIncident("ibkr_heartbeat_miss", "warning", `Strike 1: no response in ${HEARTBEAT_TIMEOUT_MS}ms (clientId=${currentClientId})`);
      } else if (heartbeatMisses === 2) {
        // Strike 2: attempt soft reconnect
        console.error(`[IBKR] Heartbeat miss #2 — attempting soft reconnect`);
        recordIncident("ibkr_heartbeat_miss", "warning", `Strike 2: soft reconnect attempt (clientId=${currentClientId})`);
        // Try a fresh reqCurrentTime to see if TWS wakes up
        ib?.reqCurrentTime();
      } else {
        // Strike 3: full disconnect + hard reconnect
        console.error(`[IBKR] Heartbeat miss #3 — TWS unresponsive, forcing hard reconnect`);
        pushEvent({ type: "disconnected", timestamp: new Date().toISOString(), detail: "heartbeat_timeout_3strike" });
        totalDisconnects++;
        lastDisconnectedAt = new Date().toISOString();
        disconnectedAtMs = Date.now();
        recordIncident("ibkr_heartbeat_timeout", "critical", `3-strike timeout — TWS unresponsive after ${heartbeatMisses} misses (clientId=${currentClientId})`);
        heartbeatMisses = 0;
        destroyIB();
        scheduleReconnect(1000);
      }
    }
  }, HEARTBEAT_TIMEOUT_MS);
}

function startHeartbeat(): void {
  heartbeatMisses = 0;
  scheduleNextHeartbeat();
}

function stopHeartbeat(): void {
  if (heartbeatTimer) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }
  heartbeatMisses = 0;
}

/** Minimum TWS server version we expect. Below this we log a warning. */
const MIN_TWS_VERSION = 163; // TWS 10.30 reports server version 163

/**
 * Deterministic clientId based on transport mode to prevent collisions.
 *
 * TWS allows one connection per clientId. When Claude Desktop (MCP/stdio)
 * and Claude Code (REST) both start from the same codebase, they must use
 * different IDs. Using Math.random() was flaky — collisions still happened.
 *
 * Strategy: use the process's --mode flag to pick a deterministic base,
 * then allow a small retry window on error 326.
 *
 *   MCP-only  → base 0  (Desktop's stdio process)
 *   REST-only → base 1  (Claude Code's dev server)
 *   both      → base 2  (npm run dev — single process)
 *
 * IBKR_CLIENT_ID env var shifts the base (e.g., 10 → MCP=10, REST=11, both=12).
 */
function resolveClientId(): number {
  const base = config.ibkr.clientId; // from IBKR_CLIENT_ID env var
  const modeIdx = process.argv.indexOf("--mode");
  const mode = modeIdx !== -1 ? process.argv[modeIdx + 1]?.toLowerCase() : "both";
  const offset = mode === "mcp" ? 0 : mode === "rest" ? 1 : 2;
  return base + offset;
}

let currentClientId = resolveClientId();
let clientIdRetries = 0;

// ── Multi-callback reconnect hooks ───────────────────────────────────
// Multiple subsystems (subscriptions, ws/server, order listeners) each
// register a callback. Previously only a single callback was stored —
// the last caller's `onReconnect(cb)` silently overwrote earlier ones.
const onReconnectCallbacks: Array<{ name: string; cb: () => void }> = [];

/** Register a callback to run after reconnection.
 *  @param cb   function to call on reconnect
 *  @param name optional label for logging (defaults to "anonymous")
 */
export function onReconnect(cb: () => void, name = "anonymous"): void {
  onReconnectCallbacks.push({ name, cb });
}

export function getNextReqId(): number {
  return nextReqId++;
}

export function getIB(): IBApi {
  if (!ib) {
    ib = new IBApi({
      host: config.ibkr.host,
      port: config.ibkr.port,
      clientId: currentClientId,
    });

    ib.on(EventName.connected, () => {
      connected = true;
      clientIdRetries = 0;
      reconnectAttempts = 0; // reset backoff on successful connect
      twsVersion = ib!.serverVersion ?? null;
      lastConnectedAt = new Date().toISOString();
      // Track reconnect duration
      if (disconnectedAtMs) {
        lastReconnectDurationMs = Date.now() - disconnectedAtMs;
        disconnectedAtMs = null;
      }
      pushEvent({ type: "connected", timestamp: lastConnectedAt, clientId: currentClientId });
      console.error(`[IBKR] Connected to TWS/Gateway (clientId=${currentClientId}, mode=${accountMode()}, port=${config.ibkr.port}, serverVersion=${twsVersion})`);
      if (twsVersion !== null && twsVersion < MIN_TWS_VERSION) {
        console.error(`[IBKR] WARNING: TWS server version ${twsVersion} is below minimum ${MIN_TWS_VERSION} (TWS 10.30). Some features may not work correctly.`);
      }
      // Run all registered reconnect callbacks
      for (const { name, cb } of onReconnectCallbacks) {
        try { cb(); } catch (e: any) {
          console.error(`[IBKR] Reconnect callback "${name}" error: ${e.message}`);
        }
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      startHeartbeat();
    });

    ib.on(EventName.disconnected, () => {
      connected = false;
      twsVersion = null;
      totalDisconnects++;
      lastDisconnectedAt = new Date().toISOString();
      disconnectedAtMs = Date.now();
      pushEvent({ type: "disconnected", timestamp: lastDisconnectedAt });
      stopHeartbeat();
      console.error("[IBKR] Disconnected from TWS/Gateway");
      recordIncident("ibkr_disconnect", "warning", `Disconnected (total=${totalDisconnects}, clientId=${currentClientId})`);
      scheduleReconnect();
    });

    ib.on(EventName.error, (err: Error, code: ErrorCode, reqId: number) => {
      // Error 326 = clientId already in use
      if ((code as number) === 326) {
        pushEvent({ type: "error_326", timestamp: new Date().toISOString(), clientId: currentClientId });
        console.error(`[IBKR] ClientId ${currentClientId} already in use`);
        if (clientIdRetries < config.ibkr.maxClientIdRetries) {
          clientIdRetries++;
          currentClientId += 3; // step by 3 to avoid landing on another mode's ID
          console.error(`[IBKR] Trying clientId ${currentClientId} (attempt ${clientIdRetries}/${config.ibkr.maxClientIdRetries})`);
          destroyIB();
          scheduleReconnect(1000);
        } else {
          console.error(`[IBKR] Exhausted clientId retries. Staying on reconnect loop.`);
        }
        return;
      }
      // Error 1100 = TWS lost connectivity (TWS restart / network issue)
      // Wait longer before reconnecting to let TWS stabilize
      if ((code as number) === 1100) {
        console.error("[IBKR] TWS lost connectivity (error 1100) — waiting 10s for TWS to stabilize before reconnecting");
        pushEvent({ type: "tws_restart", timestamp: new Date().toISOString(), detail: "error_1100_tws_connectivity_lost" });
        recordIncident("ibkr_tws_restart", "critical", "TWS lost connectivity (1100) — waiting 10s before reconnect");
        disconnectedAtMs = Date.now();
        destroyIB();
        scheduleReconnect(10_000); // 10s delay for TWS stabilization
        return;
      }
      // Error 1102 = TWS connectivity restored
      if ((code as number) === 1102) {
        console.error("[IBKR] TWS connectivity restored (error 1102)");
        recordIncident("ibkr_tws_restored", "info", "TWS connectivity restored (1102)");
        heartbeatMisses = 0; // reset heartbeat on restore
        return;
      }
      if (isNonFatalError(code, err)) return;
      console.error(`[IBKR] Error ${code} (reqId=${reqId}): ${err.message}`);
    });
  }
  return ib;
}

export function getIBKRClient(): IBApi {
  return getIB();
}

function destroyIB(): void {
  if (ib) {
    try { ib.disconnect(); } catch (e: any) {
      console.error(`[IBKR] Error during disconnect cleanup: ${e.message ?? e}`);
    }
    ib = null;
    connected = false;
    twsVersion = null;
  }
}

/** Add ±25% jitter to a delay value */
function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

export function scheduleReconnect(delayMs?: number): void {
  if (reconnectTimer) return;
  const baseDelay = delayMs ?? Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
  const delay = delayMs != null ? delayMs : jitter(baseDelay); // jitter only on auto-backoff, not explicit delays
  reconnectAttempts++;
  // Only log every 5th attempt after the first few to reduce spam
  const shouldLog = reconnectAttempts <= 3 || reconnectAttempts % 5 === 0;
  pushEvent({ type: "reconnect_attempt", timestamp: new Date().toISOString(), clientId: currentClientId, detail: `attempt=${reconnectAttempts}, delay=${delay}ms` });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (shouldLog) {
      console.error(`[IBKR] Attempting reconnect (clientId=${currentClientId}, attempt=${reconnectAttempts}, nextDelay=${jitter(Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS))}ms)...`);
    }
    connect().catch(() => scheduleReconnect());
  }, delay);
}

export async function connect(): Promise<void> {
  const api = getIB();
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Connection timed out after 10 seconds"));
    }, 10000);

    const onConnect = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = (err: Error, code: ErrorCode) => {
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Connection failed (code ${code}): ${err.message}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      api.off(EventName.connected, onConnect);
      api.off(EventName.error, onError);
    };
    api.on(EventName.connected, onConnect);
    api.on(EventName.error, onError);
    api.connect();
  });
}

export function disconnect(): void {
  stopHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ib) {
    ib.disconnect();
    connected = false;
  }
}

export function isConnected(): boolean {
  return connected;
}

/** Returns the TWS server version, or null if not connected. */
export function getTwsVersion(): number | null {
  return twsVersion;
}

/** Derive account mode from port convention: 7497/4002 = paper, 7496/4001 = live */
function accountMode(): "paper" | "live" | "unknown" {
  const p = config.ibkr.port;
  if (p === 7497 || p === 4002) return "paper";
  if (p === 7496 || p === 4001) return "live";
  return "unknown";
}

/** Compute connection health score 0-100 */
export function getConnectionHealth(): number {
  // Uptime weight (50%): connected streak vs 1 hour
  const streakMs = lastConnectedAt && connected
    ? Date.now() - new Date(lastConnectedAt).getTime()
    : 0;
  const uptimeScore = Math.min(streakMs / (60 * 60 * 1000), 1) * 50;

  // Heartbeat latency weight (25%): p95 < 2000ms = perfect, > 8000ms = 0
  const p95 = heartbeatLatencies.length > 0
    ? [...heartbeatLatencies].sort((a, b) => a - b)[Math.ceil(0.95 * heartbeatLatencies.length) - 1]
    : 0;
  const latencyScore = heartbeatLatencies.length === 0
    ? 25  // no data yet, assume healthy
    : Math.max(0, 1 - (p95 - 2000) / 6000) * 25;

  // Reconnect frequency weight (25%): 0 reconnects in last hour = perfect
  const recentReconnects = connectionHistory
    .filter((e) => e.type === "reconnect_attempt" && Date.now() - new Date(e.timestamp).getTime() < 60 * 60 * 1000)
    .length;
  const reconnectScore = Math.max(0, 1 - recentReconnects / 10) * 25;

  return Math.round(uptimeScore + latencyScore + reconnectScore);
}

export function getConnectionStatus() {
  return {
    connected,
    host: config.ibkr.host,
    port: config.ibkr.port,
    clientId: currentClientId,
    mode: accountMode(),
    twsVersion,
    // Connection resilience metrics
    lastConnectedAt,
    lastDisconnectedAt,
    totalDisconnects,
    reconnectAttempts,
    uptimeSinceConnect: lastConnectedAt && connected
      ? Math.floor((Date.now() - new Date(lastConnectedAt).getTime()) / 1000)
      : null,
    lastReconnectDurationMs,
    heartbeatMisses,
    heartbeatP95Ms: heartbeatLatencies.length > 0
      ? [...heartbeatLatencies].sort((a, b) => a - b)[Math.ceil(0.95 * heartbeatLatencies.length) - 1]
      : null,
    connectionHealth: getConnectionHealth(),
    recentEvents: connectionHistory.slice(-10),
  };
}
