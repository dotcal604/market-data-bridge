import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server as HttpServer } from "http";
import { config } from "../config.js";
import { logger } from "../logging.js";

const logWs = logger.child({ module: "ws" });

// Channel types for type safety
export type Channel = "positions" | "orders" | "account" | "executions";

// Message types
export interface SubscribeMessage {
  type: "subscribe";
  channel: Channel;
}

export interface UnsubscribeMessage {
  type: "unsubscribe";
  channel: Channel;
}

export interface DataMessage {
  type: "data";
  channel: Channel;
  data: any;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface PingMessage {
  type: "ping";
}

export interface PongMessage {
  type: "pong";
}

type ClientMessage = SubscribeMessage | UnsubscribeMessage | PingMessage;
type ServerMessage = DataMessage | ErrorMessage | PongMessage;

interface ClientConnection {
  ws: WebSocket;
  channels: Set<Channel>;
  authenticated: boolean;
}

class WsServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ClientConnection> = new Map();

  start(httpServer: HttpServer): void {
    this.wss = new WebSocketServer({ noServer: true });

    // Handle WebSocket upgrade
    httpServer.on("upgrade", (request: IncomingMessage, socket, head) => {
      // Check authentication
      const apiKey = this.extractApiKey(request);
      const expectedKey = config.rest.apiKey;

      if (expectedKey && apiKey !== expectedKey) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        logWs.warn({ url: request.url }, "WebSocket connection rejected: invalid API key");
        return;
      }

      this.wss!.handleUpgrade(request, socket, head, (ws) => {
        this.wss!.emit("connection", ws, request);
      });
    });

    // Handle new connections
    this.wss.on("connection", (ws: WebSocket) => {
      const client: ClientConnection = {
        ws,
        channels: new Set(),
        authenticated: true,
      };
      this.clients.set(ws, client);
      logWs.info("WebSocket client connected");

      // Send welcome message
      this.send(ws, { type: "pong" });

      // Handle messages from client
      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as ClientMessage;
          this.handleClientMessage(ws, message);
        } catch (err: any) {
          logWs.error({ err }, "Failed to parse WebSocket message");
          this.send(ws, { type: "error", message: "Invalid JSON" });
        }
      });

      // Handle client disconnect
      ws.on("close", () => {
        const client = this.clients.get(ws);
        if (client) {
          logWs.info({ channels: Array.from(client.channels) }, "WebSocket client disconnected");
          this.clients.delete(ws);
        }
      });

      // Handle errors
      ws.on("error", (err) => {
        logWs.error({ err }, "WebSocket error");
      });
    });

    logWs.info("WebSocket server started");
  }

  private extractApiKey(request: IncomingMessage): string | undefined {
    // Check X-API-Key header
    const headerKey = request.headers["x-api-key"];
    if (headerKey) {
      return Array.isArray(headerKey) ? headerKey[0] : headerKey;
    }

    // Check Authorization header
    const auth = request.headers.authorization;
    if (auth) {
      const match = auth.match(/^Bearer\s+(.+)$/i);
      if (match) return match[1];
    }

    // Check query parameter
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const queryKey = url.searchParams.get("apiKey");
    if (queryKey) return queryKey;

    return undefined;
  }

  private handleClientMessage(ws: WebSocket, message: ClientMessage): void {
    const client = this.clients.get(ws);
    if (!client) return;

    switch (message.type) {
      case "subscribe": {
        const channel = message.channel;
        if (this.isValidChannel(channel)) {
          client.channels.add(channel);
          logWs.info({ channel }, "Client subscribed to channel");
        } else {
          this.send(ws, { type: "error", message: `Invalid channel: ${channel}` });
        }
        break;
      }

      case "unsubscribe": {
        const channel = message.channel;
        client.channels.delete(channel);
        logWs.info({ channel }, "Client unsubscribed from channel");
        break;
      }

      case "ping": {
        this.send(ws, { type: "pong" });
        break;
      }

      default: {
        this.send(ws, { type: "error", message: "Unknown message type" });
      }
    }
  }

  private isValidChannel(channel: string): channel is Channel {
    return ["positions", "orders", "account", "executions"].includes(channel);
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (err: any) {
        logWs.error({ err }, "Failed to send WebSocket message");
      }
    }
  }

  // Broadcast data to all clients subscribed to a channel
  broadcast(channel: Channel, data: any): void {
    const message: DataMessage = { type: "data", channel, data };
    const payload = JSON.stringify(message);

    let sentCount = 0;
    for (const [ws, client] of this.clients) {
      if (client.channels.has(channel) && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
          sentCount++;
        } catch (err: any) {
          logWs.error({ err, channel }, "Failed to broadcast to client");
        }
      }
    }

    if (sentCount > 0) {
      logWs.debug({ channel, clients: sentCount }, "Broadcast sent");
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getChannelSubscribers(channel: Channel): number {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.channels.has(channel)) {
        count++;
      }
    }
    return count;
  }
}

// Singleton instance
export const wsServer = new WsServer();
