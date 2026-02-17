import { IBApi, EventName, ErrorCode, isNonFatalError } from "@stoqey/ib";
import { config } from "../config.js";
import { recordIncident } from "../ops/metrics.js";

let ib: IBApi | null = null;
let connected = false;
let nextReqId = 1;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const RECONNECT_BASE_MS = 5_000;     // start at 5s
const RECONNECT_MAX_MS = 5 * 60_000; // cap at 5 minutes
let twsVersion: number | null = null;

// ── Connection metrics & history ─────────────────────────────────────
interface ConnectionEvent {
  type: "connected" | "disconnected" | "error_326" | "reconnect_attempt";
  timestamp: string;
  clientId?: number;
  detail?: string;
}

const MAX_HISTORY = 50;
const connectionHistory: ConnectionEvent[] = [];
let totalDisconnects = 0;
let lastConnectedAt: string | null = null;
let lastDisconnectedAt: string | null = null;

function pushEvent(evt: ConnectionEvent): void {
  connectionHistory.push(evt);
  if (connectionHistory.length > MAX_HISTORY) {
    connectionHistory.splice(0, connectionHistory.length - MAX_HISTORY);
  }
}

// ── Heartbeat / keepalive ────────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 60_000;  // ping TWS every 60s
const HEARTBEAT_TIMEOUT_MS = 10_000;   // force reconnect if no reply in 10s
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (!connected || !ib) return;
    let responded = false;
    const onTime = () => { responded = true; };
    ib.on(EventName.currentTime, onTime);
    ib.reqCurrentTime();
    setTimeout(() => {
      ib?.off(EventName.currentTime, onTime);
      if (!responded && connected) {
        console.error("[IBKR] Heartbeat timeout — TWS unresponsive, forcing reconnect");
        pushEvent({ type: "disconnected", timestamp: new Date().toISOString(), detail: "heartbeat_timeout" });
        totalDisconnects++;
        lastDisconnectedAt = new Date().toISOString();
        recordIncident("ibkr_heartbeat_timeout", "critical", `TWS unresponsive after ${HEARTBEAT_TIMEOUT_MS}ms — forcing reconnect (clientId=${currentClientId})`);
        destroyIB();
        scheduleReconnect(1000);
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
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

export function scheduleReconnect(delayMs?: number): void {
  if (reconnectTimer) return;
  const delay = delayMs ?? Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
  reconnectAttempts++;
  // Only log every 5th attempt after the first few to reduce spam
  const shouldLog = reconnectAttempts <= 3 || reconnectAttempts % 5 === 0;
  pushEvent({ type: "reconnect_attempt", timestamp: new Date().toISOString(), clientId: currentClientId, detail: `attempt=${reconnectAttempts}, delay=${delay}ms` });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (shouldLog) {
      console.error(`[IBKR] Attempting reconnect (clientId=${currentClientId}, attempt=${reconnectAttempts}, nextDelay=${Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS)}ms)...`);
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
    recentEvents: connectionHistory.slice(-10),
  };
}
