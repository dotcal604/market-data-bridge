import { IBApi, EventName, ErrorCode, isNonFatalError } from "@stoqey/ib";
import { config } from "../config.js";
import {
  recordHeartbeatLatency,
  recordIncident,
  recordReconnectDuration,
  recordReconnectStart,
} from "../ops/metrics.js";

let ib: IBApi | null = null;
let connected = false;
let nextReqId = 1;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const RECONNECT_STEPS_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;
let twsVersion: number | null = null;
let reconnectStartedAtMs: number | null = null;

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
const HEARTBEAT_INTERVAL_MS = 60_000;  // ping TWS every ~60s
const HEARTBEAT_JITTER_MS = 2_000;     // ±2s jitter
const HEARTBEAT_TIMEOUT_MS = 10_000;   // force reconnect if no reply in 10s
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatMisses = 0;

function getHeartbeatAction(misses: number): "warning" | "soft_reconnect" | "hard_reconnect" {
  if (misses <= 1) return "warning";
  if (misses === 2) return "soft_reconnect";
  return "hard_reconnect";
}

function getReconnectBaseDelayMs(attempt: number): number {
  return RECONNECT_STEPS_MS[Math.min(attempt, RECONNECT_STEPS_MS.length - 1)];
}

function getErrorReconnectDelayMs(code: number): number | null | undefined {
  if (code === 1100) return 10_000;
  if (code === 504) return undefined;
  return null;
}

function nextHeartbeatDelayMs(): number {
  const jitter = Math.floor((Math.random() * (HEARTBEAT_JITTER_MS * 2 + 1)) - HEARTBEAT_JITTER_MS);
  return Math.max(1_000, HEARTBEAT_INTERVAL_MS + jitter);
}

function resetHeartbeatState(): void {
  heartbeatMisses = 0;
}

function softReconnect(reason: string): void {
  if (!ib) return;
  console.error(`[IBKR] Soft reconnect: ${reason}`);
  recordIncident("ibkr_soft_reconnect", "warning", reason);
  try {
    ib.disconnect();
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[IBKR] Soft reconnect disconnect failed: ${detail}`);
  }
  scheduleReconnect();
}

function hardReconnect(reason: string, delayMs?: number): void {
  console.error(`[IBKR] Hard reconnect: ${reason}`);
  recordIncident("ibkr_hard_reconnect", "critical", reason);
  pushEvent({ type: "disconnected", timestamp: new Date().toISOString(), detail: reason });
  totalDisconnects++;
  lastDisconnectedAt = new Date().toISOString();
  destroyIB();
  scheduleReconnect(delayMs);
}

function runHeartbeat(): void {
  heartbeatTimer = null;
  if (!connected || !ib) {
    startHeartbeat();
    return;
  }

  let responded = false;
  const startedAt = Date.now();
  const onTime = () => {
    responded = true;
    const latencyMs = Date.now() - startedAt;
    recordHeartbeatLatency(latencyMs);
    resetHeartbeatState();
  };

  ib.on(EventName.currentTime, onTime);
  ib.reqCurrentTime();

  setTimeout(() => {
    ib?.off(EventName.currentTime, onTime);
    if (responded || !connected) return;

    heartbeatMisses++;
    const detail = `miss=${heartbeatMisses}`;
    recordIncident("heartbeat_miss", "warning", detail);

    const action = getHeartbeatAction(heartbeatMisses);
    if (action === "warning") {
      console.error(`[IBKR] Heartbeat miss 1/3 (${HEARTBEAT_TIMEOUT_MS}ms timeout)`);
    } else if (action === "soft_reconnect") {
      softReconnect("heartbeat miss 2/3");
    } else {
      hardReconnect("heartbeat miss 3/3", 1_000);
    }
  }, HEARTBEAT_TIMEOUT_MS);

  startHeartbeat();
}

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setTimeout(() => runHeartbeat(), nextHeartbeatDelayMs());
}

function stopHeartbeat(): void {
  if (heartbeatTimer) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }
  resetHeartbeatState();
}

function computeReconnectDelayMs(attempt: number): number {
  const base = getReconnectBaseDelayMs(attempt);
  const jitterMultiplier = 1 + ((Math.random() * 0.5) - 0.25);
  return Math.round(base * jitterMultiplier);
}

/** Minimum TWS server version we expect. Below this we log a warning. */
const MIN_TWS_VERSION = 163; // TWS 10.30 reports server version 163

/**
 * Compute a unique-ish clientId for this process.
 *
 * Layout:  base (from IBKR_CLIENT_ID env) + modeOffset (0/1/2) + pidSlot (0..12, step 3)
 *
 * - base=0,  mode=both → bridge     clientId ≈ 2 + pidSlot
 * - base=5,  mode=mcp  → Code MCP   clientId ≈ 5 + pidSlot
 * - base=10, mode=mcp  → Desktop    clientId ≈ 10 + pidSlot
 *
 * PID-based slot ensures concurrent processes (e.g. Desktop spawning 3)
 * start on different clientIds without collision.
 * Error-326 retry still bumps by +3, staying in the same mod-3 lane.
 *
 * Range: base + 0..2 + 0..12 + retries(0..15) = base + 0..29. TWS accepts 0–999.
 */
function resolveClientId(): number {
  const base = config.ibkr.clientId; // from IBKR_CLIENT_ID env var
  const modeIdx = process.argv.indexOf("--mode");
  const mode = modeIdx !== -1 ? process.argv[modeIdx + 1]?.toLowerCase() : "both";
  const modeOffset = mode === "mcp" ? 0 : mode === "rest" ? 1 : 2;
  // PID-based slot spreads concurrent processes across clientId space.
  // slot = (PID % 5) * 3  →  0, 3, 6, 9, 12
  // Mod-3 lane separation preserved, so error-326 retries (+3) never cross modes.
  const slot = (process.pid % 5) * 3;
  return base + modeOffset + slot;
}

let currentClientId = resolveClientId();
let clientIdRetries = 0;

// ── Multi-callback reconnect hooks ───────────────────────────────────
// Multiple subsystems (subscriptions, ws/server, order listeners) each
// register a callback. Previously only a single callback was stored —
// the last caller's `onReconnect(cb)` silently overwrote earlier ones.
const onReconnectCallbacks: Array<{ name: string; cb: () => void }> = [];

/**
 * Register a callback to be executed when the IBKR connection is re-established.
 * @param cb Callback function
 * @param name Optional label for logging
 */
export function onReconnect(cb: () => void, name = "anonymous"): void {
  onReconnectCallbacks.push({ name, cb });
}

/**
 * Get the next available request ID.
 * @returns Unique request ID
 */
export function getNextReqId(): number {
  return nextReqId++;
}

/**
 * Get the singleton IBApi instance, initializing it if necessary.
 * @returns IBApi instance
 */
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
      if (reconnectStartedAtMs !== null) {
        recordReconnectDuration(Date.now() - reconnectStartedAtMs);
        reconnectStartedAtMs = null;
      }
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
      recordReconnectStart();
      reconnectStartedAtMs = Date.now();
      scheduleReconnect();
    });

    ib.on(EventName.error, (err: Error, code: ErrorCode, reqId: number) => {
      const numericCode = code as number;
      if (numericCode === 1100) {
        recordIncident("ibkr_tws_connectivity_lost", "critical", "TWS connectivity lost (1100)");
        stopHeartbeat();
        recordReconnectStart();
        reconnectStartedAtMs = Date.now();
        const waitMs = getErrorReconnectDelayMs(numericCode);
        scheduleReconnect(waitMs === null ? undefined : waitMs);
        return;
      }
      if (numericCode === 1102) {
        console.error("[IBKR] TWS connectivity restored (1102)");
        recordIncident("ibkr_tws_connectivity_restored", "info", "Connectivity restored (1102)");
        resetHeartbeatState();
        startHeartbeat();
        return;
      }
      if (numericCode === 504) {
        recordIncident("ibkr_not_connected", "warning", "Not connected (504)");
        recordReconnectStart();
        reconnectStartedAtMs = Date.now();
        const waitMs = getErrorReconnectDelayMs(numericCode);
        scheduleReconnect(waitMs === null ? undefined : waitMs);
        return;
      }
      // Error 326 = clientId already in use
      if (numericCode === 326) {
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

/**
 * Alias for getIB().
 * @returns IBApi instance
 */
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

/**
 * Schedule a reconnection attempt.
 * @param delayMs Optional delay in milliseconds. If omitted, uses exponential backoff.
 */
export function scheduleReconnect(delayMs?: number): void {
  if (reconnectTimer) return;
  const attempt = reconnectAttempts;
  const delay = delayMs ?? computeReconnectDelayMs(attempt);
  reconnectAttempts++;
  // Only log every 5th attempt after the first few to reduce spam
  const shouldLog = reconnectAttempts <= 3 || reconnectAttempts % 5 === 0;
  pushEvent({ type: "reconnect_attempt", timestamp: new Date().toISOString(), clientId: currentClientId, detail: `attempt=${reconnectAttempts}, delay=${delay}ms` });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (shouldLog) {
      console.error(`[IBKR] Attempting reconnect (clientId=${currentClientId}, attempt=${reconnectAttempts}, nextDelay=${computeReconnectDelayMs(reconnectAttempts)}ms)...`);
    }
    connect().catch(() => scheduleReconnect());
  }, delay);
}

/**
 * Connect to TWS or IB Gateway.
 * @returns Promise that resolves when connected
 */
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

/**
 * Disconnect from TWS or IB Gateway.
 */
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

/**
 * Check if currently connected to TWS/Gateway.
 * @returns True if connected
 */
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

/**
 * Get detailed connection status and metrics.
 * @returns Connection status object
 */
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

export const __test = {
  computeReconnectDelayMs,
  getHeartbeatAction,
  getReconnectBaseDelayMs,
  getErrorReconnectDelayMs,
};
