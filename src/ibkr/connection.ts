import { IBApi, EventName, ErrorCode, isNonFatalError } from "@stoqey/ib";
import { config } from "../config.js";

let ib: IBApi | null = null;
let connected = false;
let nextReqId = 1;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
let onReconnectCallback: (() => void) | null = null;

/** Register a callback to run after reconnection (used by subscriptions manager) */
export function onReconnect(cb: () => void): void {
  onReconnectCallback = cb;
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
      console.error(`[IBKR] Connected to TWS/Gateway (clientId=${currentClientId}, mode=${accountMode()}, port=${config.ibkr.port})`);
      if (onReconnectCallback) {
        try { onReconnectCallback(); } catch (e: any) {
          console.error(`[IBKR] Reconnect callback error: ${e.message}`);
        }
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    });

    ib.on(EventName.disconnected, () => {
      connected = false;
      console.error("[IBKR] Disconnected from TWS/Gateway");
      scheduleReconnect();
    });

    ib.on(EventName.error, (err: Error, code: ErrorCode, reqId: number) => {
      // Error 326 = clientId already in use
      if ((code as number) === 326) {
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
  }
}

export function scheduleReconnect(delayMs = 5000): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    console.error(`[IBKR] Attempting reconnect (clientId=${currentClientId})...`);
    connect().catch(() => scheduleReconnect());
  }, delayMs);
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
  };
}
