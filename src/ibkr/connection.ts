import { IBApi, EventName, ErrorCode, isNonFatalError } from "@stoqey/ib";
import { config } from "../config.js";

let ib: IBApi | null = null;
let connected = false;
let nextReqId = 1;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
// Randomize clientId to avoid collisions when Desktop spawns multiple MCP processes
let currentClientId = config.ibkr.clientId + Math.floor(Math.random() * 100);
let clientIdRetries = 0;

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
          currentClientId++;
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
