/**
 * Authenticated WebSocket server for real-time IBKR event streaming.
 * Clients connect to /ws, authenticate with API key, then subscribe
 * to channels: positions, orders, account, executions.
 *
 * Based on Codex PR #173 with fixes:
 * - Uses @types/ws instead of hand-written .d.ts
 * - Lazy-binds IBKR events (guards against getIB() when not connected)
 * - Re-binds IBKR listeners on reconnect via onReconnect() hook
 */
import { EventName } from "@stoqey/ib";
import { timingSafeEqual } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "../config.js";
import { getIB, isConnected, onReconnect } from "../ibkr/connection.js";
import { logger } from "../logging.js";

const logWs = logger.child({ subsystem: "ws" });

// Module-level broadcast reference (set by initWebSocket, callable externally)
let _broadcast: ((channel: string, data: unknown) => void) | null = null;

// Message sequence counter for ordering guarantee
let messageSequence = 0;
const getSequenceId = (): number => ++messageSequence;

/**
 * Broadcast data to all authenticated WebSocket clients subscribed to a channel.
 * No-op if WebSocket server not initialized yet.
 */
export function wsBroadcast(channel: string, data: unknown): void {
  if (_broadcast) _broadcast(channel, data);
}

/**
 * Broadcast with explicit sequence ID (used internally for ordered messages).
 */
export function wsBroadcastWithSequence(channel: string, data: unknown, sequenceId: number): void {
  if (!_broadcast) return;
  const dataWithSeq = typeof data === "object" && data !== null
    ? { ...(data as Record<string, unknown>), sequence_id: sequenceId }
    : { data, sequence_id: sequenceId };
  _broadcast(channel, dataWithSeq);
}

/**
 * Get next sequence ID for guaranteed message ordering.
 * Used by eval, journal, and order emitters.
 */
export function getNextSequenceId(): number {
  return getSequenceId();
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const VALID_CHANNELS = new Set(["positions", "orders", "account", "executions", "signals", "status", "inbox", "incidents", "eval", "holly", "eval_created", "journal_posted", "order_filled"]);

type ChannelName = "positions" | "orders" | "account" | "executions" | "signals" | "status" | "inbox" | "incidents" | "eval" | "holly" | "eval_created" | "journal_posted" | "order_filled";

interface AuthMessage { type: "auth"; apiKey: string }
interface SubscribeMessage { type: "subscribe"; channel: string }
type ClientMessage = AuthMessage | SubscribeMessage;

interface AuthenticatedWebSocket extends WebSocket {
  isAlive?: boolean;
  isAuthenticated?: boolean;
}

function parseMessage(raw: WebSocket.RawData): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw.toString());
    if (!parsed || typeof parsed !== "object") return null;
    const m = parsed as Record<string, unknown>;
    if (m.type === "auth" && typeof m.apiKey === "string") {
      return { type: "auth", apiKey: m.apiKey };
    }
    if (m.type === "subscribe" && typeof m.channel === "string") {
      return { type: "subscribe", channel: m.channel };
    }
    return null;
  } catch {
    return null;
  }
}

function isApiKeyValid(provided: string): boolean {
  const expected = config.rest.apiKey;
  if (!expected) return true; // No key configured = open access (matches REST behavior)
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function initWebSocket(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const subscriptions = new Map<WebSocket, Set<ChannelName>>();

  const broadcast = (channel: string, data: unknown): void => {
    const payload = JSON.stringify({ channel, data });
    for (const [client, channels] of subscriptions.entries()) {
      if (!channels.has(channel as ChannelName) || client.readyState !== WebSocket.OPEN) continue;
      client.send(payload);
    }
  };

  // Expose broadcast to module-level wsBroadcast() export
  _broadcast = broadcast;

  // ── Bind IBKR event listeners (only when connected) ──
  let ibkrBound = false;

  function bindIBKR(): void {
    if (!isConnected()) return;
    if (ibkrBound) return;
    try {
      const ib = getIB();
      ib.on(EventName.openOrder, (...args: unknown[]) => broadcast("orders", args));
      ib.on(EventName.orderStatus, (...args: unknown[]) => broadcast("orders", args));
      (ib as any).on(EventName.updatePortfolio, (...args: unknown[]) => broadcast("positions", args));
      (ib as any).on(EventName.updateAccountValue, (...args: unknown[]) => broadcast("account", args));
      ib.on(EventName.execDetails, (...args: unknown[]) => broadcast("executions", args));
      ibkrBound = true;
      logWs.info("IBKR event listeners bound to WebSocket broadcast");
    } catch (err) {
      logWs.warn({ err }, "Failed to bind IBKR events — will retry on reconnect");
    }
  }

  // Bind now if already connected, and re-bind on every reconnect
  bindIBKR();
  onReconnect(() => {
    ibkrBound = false;
    bindIBKR();
    // Broadcast connection status on reconnect
    broadcast("status", {
      ibkr_connected: true,
      timestamp: new Date().toISOString(),
    });
  }, "ws/server");

  // ── Bind IBKR connection status listeners ──
  // These must be bound outside bindIBKR() as they need to work when disconnected
  let statusBound = false;
  function bindStatusListeners(): void {
    if (statusBound) return;
    try {
      const ib = getIB();
      ib.on(EventName.connected, () => {
        broadcast("status", {
          ibkr_connected: true,
          timestamp: new Date().toISOString(),
        });
      });
      ib.on(EventName.disconnected, () => {
        broadcast("status", {
          ibkr_connected: false,
          timestamp: new Date().toISOString(),
        });
      });
      statusBound = true;
      logWs.info("IBKR status listeners bound to WebSocket broadcast");
    } catch (err) {
      logWs.warn({ err }, "Failed to bind IBKR status listeners");
    }
  }
  bindStatusListeners();

  // ── WebSocket connection handling ──
  wss.on("connection", (socket: AuthenticatedWebSocket) => {
    socket.isAlive = true;
    socket.isAuthenticated = false;
    subscriptions.set(socket, new Set<ChannelName>());

    socket.on("pong", () => { socket.isAlive = true; });

    socket.on("message", (rawData: WebSocket.RawData) => {
      const message = parseMessage(rawData);
      if (!message) {
        socket.close(1008, "Invalid message");
        return;
      }

      // Auth flow: first message must be auth
      if (!socket.isAuthenticated) {
        if (message.type !== "auth") {
          socket.close(1008, "Authentication required");
          return;
        }
        if (!isApiKeyValid(message.apiKey)) {
          socket.close(1008, "Invalid API key");
          return;
        }
        socket.isAuthenticated = true;
        socket.send(JSON.stringify({ type: "auth", ok: true }));
        
        // Auto-subscribe to status channel
        const channels = subscriptions.get(socket);
        if (channels) {
          channels.add("status");
          // Send initial status
          socket.send(JSON.stringify({
            channel: "status",
            data: {
              ibkr_connected: isConnected(),
              timestamp: new Date().toISOString(),
            },
          }));
        }
        return;
      }

      // Subscribe flow
      if (message.type !== "subscribe") return;
      if (!VALID_CHANNELS.has(message.channel)) {
        socket.close(1008, "Invalid channel");
        return;
      }
      const channels = subscriptions.get(socket);
      if (!channels) { socket.close(1011, "Subscription state unavailable"); return; }
      channels.add(message.channel as ChannelName);
      socket.send(JSON.stringify({ type: "subscribed", channel: message.channel }));
    });

    socket.on("close", () => { subscriptions.delete(socket); });
    socket.on("error", (err: Error) => { logWs.warn({ err }, "WebSocket client error"); });
  });

  // ── Heartbeat: terminate stale clients ──
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const s = client as AuthenticatedWebSocket;
      if (!s.isAlive) {
        subscriptions.delete(s);
        s.terminate();
        continue;
      }
      s.isAlive = false;
      s.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => {
    clearInterval(heartbeat);
    subscriptions.clear();
  });

  logWs.info({ path: "/ws" }, "WebSocket server initialized");
}
