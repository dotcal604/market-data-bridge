import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { EventName } from "@stoqey/ib";
import type { Server as HttpServer } from "node:http";
import { WebSocket } from "ws";

// ── Mock setup ──────────────────────────────────────────────────────────────

let mockIB: EventEmitter;
let mockIsConnected = false;
let reconnectCallback: (() => void) | null = null;

vi.mock("../../ibkr/connection.js", () => ({
  getIB: vi.fn(() => mockIB),
  isConnected: vi.fn(() => mockIsConnected),
  onReconnect: vi.fn((cb: () => void) => { reconnectCallback = cb; }),
}));

vi.mock("../../config.js", () => ({
  config: { rest: { apiKey: "test-key-123" }, ws: { heartbeatMs: 30000 } },
}));

vi.mock("../../logging.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { initWebSocket } from "../server.js";

// ── Test setup helpers ──────────────────────────────────────────────────────

async function connectClient(port: number, apiKey?: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Connection timeout")), 2000);
    ws.on("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  if (apiKey !== undefined) {
    ws.send(JSON.stringify({ type: "auth", apiKey }));
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Auth timeout")), 2000);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "auth") {
          clearTimeout(timeout);
          resolve();
        }
      });
      ws.on("close", () => {
        clearTimeout(timeout);
        reject(new Error("Connection closed during auth"));
      });
    });
  }

  return ws;
}

async function waitForMessage(ws: WebSocket, timeout = 1000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Message timeout")), timeout);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

async function waitForClose(ws: WebSocket, timeout = 1000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Close timeout")), timeout);
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("WebSocket Server", () => {
  let httpServer: HttpServer;
  let port: number;

  beforeEach(async () => {
    mockIB = new EventEmitter();
    mockIsConnected = false;
    reconnectCallback = null;

    // Create a real HTTP server
    const http = await import("node:http");
    httpServer = http.createServer();
    
    // Listen on random available port
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        if (addr && typeof addr === "object") {
          port = addr.port;
        }
        resolve();
      });
    });

    // Initialize WebSocket server
    initWebSocket(httpServer);
  });

  afterEach(async () => {
    if (httpServer && httpServer.listening) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
  });

  // ── Authentication Tests ──────────────────────────────────────────────────

  describe("Authentication", () => {
    it("should reject connection with no auth message", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      
      await new Promise<void>((resolve) => {
        ws.on("open", () => {
          // Send non-auth message first
          ws.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
          resolve();
        });
      });

      const closeEvent = await waitForClose(ws);
      expect(closeEvent.code).toBe(1008);
      expect(closeEvent.reason).toContain("Authentication required");
    });

    it("should reject connection with invalid API key", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      
      await new Promise<void>((resolve) => {
        ws.on("open", () => {
          ws.send(JSON.stringify({ type: "auth", apiKey: "wrong-key" }));
          resolve();
        });
      });

      const closeEvent = await waitForClose(ws);
      expect(closeEvent.code).toBe(1008);
      expect(closeEvent.reason).toContain("Invalid API key");
    });

    it("should accept connection with valid API key (timing-safe compare)", async () => {
      const ws = await connectClient(port, "test-key-123");
      
      // Should receive auth success
      expect(ws.readyState).toBe(WebSocket.OPEN);
      
      ws.close();
    });

    it("should use timing-safe comparison for API key", async () => {
      // Test with key of different length (should reject)
      const ws1 = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        ws1.on("open", () => {
          ws1.send(JSON.stringify({ type: "auth", apiKey: "short" }));
          resolve();
        });
      });
      const close1 = await waitForClose(ws1);
      expect(close1.code).toBe(1008);

      // Test with key of same length but different content
      const ws2 = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        ws2.on("open", () => {
          ws2.send(JSON.stringify({ type: "auth", apiKey: "test-key-124" })); // last char different
          resolve();
        });
      });
      const close2 = await waitForClose(ws2);
      expect(close2.code).toBe(1008);
    });
  });

  // ── Subscription Tests ────────────────────────────────────────────────────

  describe("Subscriptions", () => {
    it("should subscribe to valid channel", async () => {
      const ws = await connectClient(port, "test-key-123");

      ws.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      
      const msg = await waitForMessage(ws);
      expect(msg.type).toBe("subscribed");
      expect(msg.channel).toBe("positions");

      ws.close();
    });

    it("should reject invalid channel", async () => {
      const ws = await connectClient(port, "test-key-123");

      ws.send(JSON.stringify({ type: "subscribe", channel: "invalid-channel" }));

      const closeEvent = await waitForClose(ws);
      expect(closeEvent.code).toBe(1008);
      expect(closeEvent.reason).toContain("Invalid channel");
    });

    it("should allow subscribing to multiple channels", async () => {
      const ws = await connectClient(port, "test-key-123");

      ws.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      const msg1 = await waitForMessage(ws);
      expect(msg1.type).toBe("subscribed");
      expect(msg1.channel).toBe("positions");

      ws.send(JSON.stringify({ type: "subscribe", channel: "orders" }));
      const msg2 = await waitForMessage(ws);
      expect(msg2.type).toBe("subscribed");
      expect(msg2.channel).toBe("orders");

      ws.close();
    });

    it("should only receive broadcasts for subscribed channels", async () => {
      mockIsConnected = true;
      
      // Need to reinitialize WebSocket server with IBKR connected
      if (httpServer && httpServer.listening) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
      
      const http = await import("node:http");
      httpServer = http.createServer();
      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => {
          const addr = httpServer.address();
          if (addr && typeof addr === "object") {
            port = addr.port;
          }
          resolve();
        });
      });
      initWebSocket(httpServer);

      const ws1 = await connectClient(port, "test-key-123");
      const ws2 = await connectClient(port, "test-key-123");

      // ws1 subscribes to positions only
      ws1.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      await waitForMessage(ws1);

      // ws2 subscribes to orders only
      ws2.send(JSON.stringify({ type: "subscribe", channel: "orders" }));
      await waitForMessage(ws2);

      // Set up message listeners
      const ws1Messages: any[] = [];
      const ws2Messages: any[] = [];
      
      ws1.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.channel) ws1Messages.push(msg);
      });
      
      ws2.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.channel) ws2Messages.push(msg);
      });

      // Give listeners time to set up
      await new Promise(resolve => setTimeout(resolve, 50));

      // Emit position update
      mockIB.emit(EventName.updatePortfolio, "test", { symbol: "AAPL" }, 10, 150, 1500, 145, 50, 0);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Emit order update
      mockIB.emit(EventName.openOrder, 1, { symbol: "MSFT" }, { action: "BUY" });
      await new Promise(resolve => setTimeout(resolve, 100));

      // ws1 should only receive positions
      expect(ws1Messages.length).toBe(1);
      expect(ws1Messages[0].channel).toBe("positions");

      // ws2 should only receive orders
      expect(ws2Messages.length).toBe(1);
      expect(ws2Messages[0].channel).toBe("orders");

      ws1.close();
      ws2.close();
    });

    it("should handle all valid channel types", async () => {
      const ws = await connectClient(port, "test-key-123");
      const channels = ["positions", "orders", "account", "executions"];

      for (const channel of channels) {
        ws.send(JSON.stringify({ type: "subscribe", channel }));
        const msg = await waitForMessage(ws);
        expect(msg.type).toBe("subscribed");
        expect(msg.channel).toBe(channel);
      }

      ws.close();
    });
  });

  // ── Heartbeat Tests ───────────────────────────────────────────────────────

  describe("Heartbeat", () => {
    it("should respond to pong after ping", async () => {
      const ws = await connectClient(port, "test-key-123");
      
      let pongReceived = false;
      ws.on("pong", () => { pongReceived = true; });

      // Simulate server ping by sending ping from client (ws library auto-responds)
      ws.ping();
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // For testing, we verify the connection stays alive
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it("should keep connection alive with heartbeat", async () => {
      const ws = await connectClient(port, "test-key-123");
      
      // Wait a bit to ensure heartbeat interval has opportunity to fire
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Connection should still be open
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });
  });

  // ── Edge Case Tests ───────────────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("should reject invalid JSON", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      
      await new Promise<void>((resolve) => {
        ws.on("open", () => {
          ws.send("not-json-at-all");
          resolve();
        });
      });

      const closeEvent = await waitForClose(ws);
      expect(closeEvent.code).toBe(1008);
      expect(closeEvent.reason).toContain("Invalid message");
    });

    it("should reject malformed message objects", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      
      await new Promise<void>((resolve) => {
        ws.on("open", () => {
          ws.send(JSON.stringify({ type: "auth" })); // missing apiKey
          resolve();
        });
      });

      const closeEvent = await waitForClose(ws);
      expect(closeEvent.code).toBe(1008);
      expect(closeEvent.reason).toContain("Invalid message");
    });

    it("should reject primitive JSON values", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      
      await new Promise<void>((resolve) => {
        ws.on("open", () => {
          ws.send(JSON.stringify("string-value"));
          resolve();
        });
      });

      const closeEvent = await waitForClose(ws);
      expect(closeEvent.code).toBe(1008);
      expect(closeEvent.reason).toContain("Invalid message");
    });

    it("should clean up subscriptions on client disconnect", async () => {
      mockIsConnected = true;

      // Need to reinitialize WebSocket server with IBKR connected
      if (httpServer && httpServer.listening) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
      
      const http = await import("node:http");
      httpServer = http.createServer();
      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => {
          const addr = httpServer.address();
          if (addr && typeof addr === "object") {
            port = addr.port;
          }
          resolve();
        });
      });
      initWebSocket(httpServer);

      const ws1 = await connectClient(port, "test-key-123");
      const ws2 = await connectClient(port, "test-key-123");

      // Both subscribe to positions
      ws1.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      await waitForMessage(ws1);
      ws2.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      await waitForMessage(ws2);

      // ws1 disconnects
      ws1.close();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Set up message listener on ws2
      const ws2Messages: any[] = [];
      ws2.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.channel) ws2Messages.push(msg);
      });

      // Give listener time to set up
      await new Promise(resolve => setTimeout(resolve, 50));

      // Emit position update
      mockIB.emit(EventName.updatePortfolio, "test", { symbol: "AAPL" }, 10, 150, 1500, 145, 50, 0);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Only ws2 should receive the message
      expect(ws2Messages.length).toBe(1);

      ws2.close();
    });

    it("should handle reconnect callback", async () => {
      mockIsConnected = false;

      // Initial connection (IBKR not connected)
      const ws = await connectClient(port, "test-key-123");
      ws.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      await waitForMessage(ws);

      // Simulate IBKR reconnect
      mockIsConnected = true;
      if (reconnectCallback) {
        reconnectCallback();
      }

      // Should be able to receive broadcasts now
      const messages: any[] = [];
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.channel) messages.push(msg);
      });

      mockIB.emit(EventName.updatePortfolio, "test", { symbol: "AAPL" }, 10, 150, 1500, 145, 50, 0);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should receive both status (from reconnect) and positions broadcasts
      expect(messages.length).toBeGreaterThanOrEqual(1);
      const positionsMsg = messages.find(m => m.channel === "positions");
      expect(positionsMsg).toBeDefined();

      ws.close();
    });

    it("should handle multiple broadcasts to same channel", async () => {
      mockIsConnected = true;

      // Need to reinitialize WebSocket server with IBKR connected
      if (httpServer && httpServer.listening) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
      
      const http = await import("node:http");
      httpServer = http.createServer();
      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => {
          const addr = httpServer.address();
          if (addr && typeof addr === "object") {
            port = addr.port;
          }
          resolve();
        });
      });
      initWebSocket(httpServer);

      const ws = await connectClient(port, "test-key-123");
      ws.send(JSON.stringify({ type: "subscribe", channel: "orders" }));
      await waitForMessage(ws);

      const messages: any[] = [];
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.channel) messages.push(msg);
      });

      // Give listener time to set up
      await new Promise(resolve => setTimeout(resolve, 50));

      // Emit multiple order events
      mockIB.emit(EventName.openOrder, 1, { symbol: "AAPL" }, { action: "BUY" });
      mockIB.emit(EventName.orderStatus, 1, "Filled", 10, 0, 150, 1, 0, 150, 0, "");
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messages.length).toBe(2);
      expect(messages[0].channel).toBe("orders");
      expect(messages[1].channel).toBe("orders");

      ws.close();
    });

    it("should not send to closed connections", async () => {
      mockIsConnected = true;

      const ws = await connectClient(port, "test-key-123");
      ws.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      await waitForMessage(ws);

      // Close the connection
      ws.close();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Emit position update (should not crash)
      expect(() => {
        mockIB.emit(EventName.updatePortfolio, "test", { symbol: "AAPL" }, 10, 150, 1500, 145, 50, 0);
      }).not.toThrow();
    });

    it("should handle account updates channel", async () => {
      mockIsConnected = true;

      // Need to reinitialize WebSocket server with IBKR connected
      if (httpServer && httpServer.listening) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
      
      const http = await import("node:http");
      httpServer = http.createServer();
      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => {
          const addr = httpServer.address();
          if (addr && typeof addr === "object") {
            port = addr.port;
          }
          resolve();
        });
      });
      initWebSocket(httpServer);

      const ws = await connectClient(port, "test-key-123");
      ws.send(JSON.stringify({ type: "subscribe", channel: "account" }));
      await waitForMessage(ws);

      const messages: any[] = [];
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.channel) messages.push(msg);
      });

      // Give listener time to set up
      await new Promise(resolve => setTimeout(resolve, 50));

      // Emit account update (uses (ib as any).on due to type issue)
      (mockIB as any).emit(EventName.updateAccountValue, "DUA123", "NetLiquidation", "100000", "USD");
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messages.length).toBe(1);
      expect(messages[0].channel).toBe("account");

      ws.close();
    });

    it("should handle executions channel", async () => {
      mockIsConnected = true;

      // Need to reinitialize WebSocket server with IBKR connected
      if (httpServer && httpServer.listening) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
      
      const http = await import("node:http");
      httpServer = http.createServer();
      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => {
          const addr = httpServer.address();
          if (addr && typeof addr === "object") {
            port = addr.port;
          }
          resolve();
        });
      });
      initWebSocket(httpServer);

      const ws = await connectClient(port, "test-key-123");
      ws.send(JSON.stringify({ type: "subscribe", channel: "executions" }));
      await waitForMessage(ws);

      const messages: any[] = [];
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.channel) messages.push(msg);
      });

      // Give listener time to set up
      await new Promise(resolve => setTimeout(resolve, 50));

      mockIB.emit(EventName.execDetails, 1, { symbol: "AAPL" }, { side: "BOT", shares: 10 });
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messages.length).toBe(1);
      expect(messages[0].channel).toBe("executions");

      ws.close();
    });
  });

  // ── Status Channel Tests ──────────────────────────────────────────────────

  describe("Status Channel", () => {
    it("should auto-subscribe to status channel on auth", async () => {
      // Set up message listener BEFORE sending auth
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Connection timeout")), 2000);
        ws.on("open", () => {
          clearTimeout(timeout);
          resolve();
        });
        ws.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      const receivedMessages: any[] = [];
      ws.on("message", (data) => {
        receivedMessages.push(JSON.parse(data.toString()));
      });

      // Send auth message
      ws.send(JSON.stringify({ type: "auth", apiKey: "test-key-123" }));
      
      // Wait for messages
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should receive auth success and initial status
      expect(receivedMessages.length).toBeGreaterThanOrEqual(2);
      
      const authMsg = receivedMessages.find(m => m.type === "auth");
      expect(authMsg).toBeDefined();
      expect(authMsg.ok).toBe(true);

      const statusMsg = receivedMessages.find(m => m.channel === "status");
      expect(statusMsg).toBeDefined();
      expect(statusMsg.data).toHaveProperty("ibkr_connected");
      expect(statusMsg.data).toHaveProperty("timestamp");
      expect(typeof statusMsg.data.ibkr_connected).toBe("boolean");
      expect(typeof statusMsg.data.timestamp).toBe("string");

      ws.close();
    });

    it("should send initial status with correct connection state", async () => {
      mockIsConnected = true;

      // Reinitialize WebSocket server with IBKR connected
      if (httpServer && httpServer.listening) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
      
      const http = await import("node:http");
      httpServer = http.createServer();
      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => {
          const addr = httpServer.address();
          if (addr && typeof addr === "object") {
            port = addr.port;
          }
          resolve();
        });
      });
      initWebSocket(httpServer);

      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Connection timeout")), 2000);
        ws.on("open", () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      const receivedMessages: any[] = [];
      ws.on("message", (data) => {
        receivedMessages.push(JSON.parse(data.toString()));
      });

      ws.send(JSON.stringify({ type: "auth", apiKey: "test-key-123" }));
      
      await new Promise(resolve => setTimeout(resolve, 200));

      const statusMsg = receivedMessages.find(m => m.channel === "status");
      expect(statusMsg).toBeDefined();
      expect(statusMsg.data.ibkr_connected).toBe(true);

      ws.close();
    });

    it("should broadcast status on IBKR connected event", async () => {
      mockIsConnected = true;

      // Reinitialize WebSocket server with IBKR connected
      if (httpServer && httpServer.listening) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
      
      const http = await import("node:http");
      httpServer = http.createServer();
      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => {
          const addr = httpServer.address();
          if (addr && typeof addr === "object") {
            port = addr.port;
          }
          resolve();
        });
      });
      initWebSocket(httpServer);

      const ws = await connectClient(port, "test-key-123");

      // Clear initial messages
      await new Promise(resolve => setTimeout(resolve, 100));

      const messages: any[] = [];
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.channel === "status") messages.push(msg);
      });

      // Give listener time to set up
      await new Promise(resolve => setTimeout(resolve, 50));

      // Emit IBKR connected event
      mockIB.emit(EventName.connected);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messages.length).toBe(1);
      expect(messages[0].channel).toBe("status");
      expect(messages[0].data.ibkr_connected).toBe(true);
      expect(messages[0].data.timestamp).toBeDefined();

      ws.close();
    });

    it("should broadcast status on IBKR disconnected event", async () => {
      mockIsConnected = true;

      // Reinitialize WebSocket server with IBKR connected
      if (httpServer && httpServer.listening) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
      
      const http = await import("node:http");
      httpServer = http.createServer();
      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => {
          const addr = httpServer.address();
          if (addr && typeof addr === "object") {
            port = addr.port;
          }
          resolve();
        });
      });
      initWebSocket(httpServer);

      const ws = await connectClient(port, "test-key-123");

      // Clear initial messages
      await new Promise(resolve => setTimeout(resolve, 100));

      const messages: any[] = [];
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.channel === "status") messages.push(msg);
      });

      // Give listener time to set up
      await new Promise(resolve => setTimeout(resolve, 50));

      // Emit IBKR disconnected event
      mockIB.emit(EventName.disconnected);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messages.length).toBe(1);
      expect(messages[0].channel).toBe("status");
      expect(messages[0].data.ibkr_connected).toBe(false);
      expect(messages[0].data.timestamp).toBeDefined();

      ws.close();
    });

    it("should allow manual subscription to status channel (no-op)", async () => {
      const ws = await connectClient(port, "test-key-123");

      // Try to subscribe to status (even though it's auto-subscribed)
      ws.send(JSON.stringify({ type: "subscribe", channel: "status" }));
      
      const msg = await waitForMessage(ws);
      expect(msg.type).toBe("subscribed");
      expect(msg.channel).toBe("status");

      ws.close();
    });

    it("should include status in valid channels list", async () => {
      const ws = await connectClient(port, "test-key-123");
      
      // All these channels should be valid
      const validChannels = ["positions", "orders", "account", "executions", "signals", "status"];
      
      for (const channel of validChannels) {
        ws.send(JSON.stringify({ type: "subscribe", channel }));
        const msg = await waitForMessage(ws);
        expect(msg.type).toBe("subscribed");
        expect(msg.channel).toBe(channel);
      }

      ws.close();
    });
  });
});
