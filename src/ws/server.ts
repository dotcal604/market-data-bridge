import { EventName } from "@stoqey/ib";
import { timingSafeEqual } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "../config.js";
import { getIB } from "../ibkr/connection.js";
import { logger } from "../logging.js";

const logWs = logger.child({ subsystem: "ws" });
const HEARTBEAT_INTERVAL_MS = 30_000;
const VALID_CHANNELS = new Set(["positions", "orders", "account", "executions"]);

type ChannelName = "positions" | "orders" | "account" | "executions";

interface AuthMessage {
  type: "auth";
  apiKey: string;
}

interface SubscribeMessage {
  type: "subscribe";
  channel: string;
}

type ClientMessage = AuthMessage | SubscribeMessage;

interface AuthenticatedWebSocket extends WebSocket {
  isAlive?: boolean;
  isAuthenticated?: boolean;
}

function parseMessage(rawData: WebSocket.RawData): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(rawData.toString());
    if (!parsed || typeof parsed !== "object") return null;

    const message = parsed as Record<string, unknown>;
    if (message.type === "auth" && typeof message.apiKey === "string") {
      return { type: "auth", apiKey: message.apiKey };
    }
    if (message.type === "subscribe" && typeof message.channel === "string") {
      return { type: "subscribe", channel: message.channel };
    }
    return null;
  } catch {
    return null;
  }
}

function isApiKeyValid(providedApiKey: string): boolean {
  const expectedApiKey = config.rest.apiKey;
  const providedBuffer = Buffer.from(providedApiKey);
  const expectedBuffer = Buffer.from(expectedApiKey);

  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function initWebSocket(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const subscriptions = new Map<WebSocket, Set<ChannelName>>();

  const broadcast = (channel: ChannelName, data: readonly unknown[]): void => {
    const payload = JSON.stringify({ channel, data });

    for (const [client, channels] of subscriptions.entries()) {
      if (!channels.has(channel) || client.readyState !== WebSocket.OPEN) continue;
      client.send(payload);
    }
  };

  const ib = getIB();
  ib.on(EventName.openOrder, (...eventData: readonly unknown[]) => broadcast("orders", eventData));
  ib.on(EventName.orderStatus, (...eventData: readonly unknown[]) => broadcast("orders", eventData));
  ib.on(EventName.updatePortfolio, (...eventData: readonly unknown[]) => broadcast("positions", eventData));
  ib.on(EventName.updateAccountValue, (...eventData: readonly unknown[]) => broadcast("account", eventData));
  ib.on(EventName.execDetails, (...eventData: readonly unknown[]) => broadcast("executions", eventData));

  wss.on("connection", (socket: AuthenticatedWebSocket) => {
    socket.isAlive = true;
    socket.isAuthenticated = false;
    subscriptions.set(socket, new Set<ChannelName>());

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (rawData: WebSocket.RawData) => {
      const message = parseMessage(rawData);
      if (!message) {
        socket.close(1008, "Invalid message");
        return;
      }

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
        return;
      }

      if (message.type !== "subscribe") return;

      if (!VALID_CHANNELS.has(message.channel)) {
        socket.close(1008, "Invalid channel");
        return;
      }

      const channels = subscriptions.get(socket);
      if (!channels) {
        socket.close(1011, "Subscription state unavailable");
        return;
      }

      channels.add(message.channel as ChannelName);
      socket.send(JSON.stringify({ type: "subscribed", channel: message.channel }));
    });

    socket.on("close", () => {
      subscriptions.delete(socket);
    });

    socket.on("error", (err: Error) => {
      logWs.warn({ err }, "WebSocket client error");
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const socket = client as AuthenticatedWebSocket;
      if (!socket.isAlive) {
        subscriptions.delete(socket);
        socket.terminate();
        continue;
      }

      socket.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => {
    clearInterval(heartbeat);
    subscriptions.clear();
  });

  logWs.info({ path: "/ws" }, "WebSocket server initialized");
}
