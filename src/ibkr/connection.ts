import { IBApi, EventName, ErrorCode, isNonFatalError } from "@stoqey/ib";
import { config } from "../config.js";

let ib: IBApi | null = null;
let connected = false;
let nextReqId = 1;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
// Randomize clientId to avoid collisions when Desktop spawns multiple MCP processes
let currentClientId = config.ibkr.clientId + Math.floor(Math.random() * 100);
let clientIdRetries = 0;
let hadDisconnect = false;
const restoreHooks = new Set<() => void>();

function emitConnectionRestored(): void {
  for (const hook of restoreHooks) {
    try {
      hook();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IBKR] Connection restore hook failed: ${message}`);
    }
  }
}

export function onConnectionRestored(hook: () => void): () => void {
  restoreHooks.add(hook);
  return () => restoreHooks.delete(hook);
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
      const isRestore = hadDisconnect;
      connected = true;
      clientIdRetries = 0;
      console.error(`[IBKR] Connected to TWS/Gateway (clientId=${currentClientId})`);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (isRestore) {
        hadDisconnect = false;
        emitConnectionRestored();
      }
    });

    ib.on(EventName.disconnected, () => {
      connected = false;
      hadDisconnect = true;
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

export function getConnectionStatus() {
  return {
    connected,
    host: config.ibkr.host,
    port: config.ibkr.port,
    clientId: currentClientId,
  };
}
