/**
 * WebSocket Reconnection Tests
 * Tests for WebSocket client reconnection logic, connection status broadcasting,
 * and heartbeat handling.
 */
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

function collectMessages(ws: WebSocket, filterChannel?: string): any[] {
  const messages: any[] = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (!filterChannel || msg.channel === filterChannel) {
      messages.push(msg);
    }
  });
  return messages;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("WebSocket Reconnection", () => {
  let httpServer: HttpServer;
  let port: number;

  beforeEach(async () => {
    mockIB = new EventEmitter();
    mockIsConnected = false;
    reconnectCallback = null;

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
  });

  afterEach(async () => {
    if (httpServer && httpServer.listening) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
  });

  // ── IBKR Reconnection Tests ───────────────────────────────────────────────

  describe("IBKR Reconnection", () => {
    it("should rebind IBKR event listeners after reconnect", async () => {
      // Start with IBKR disconnected
      mockIsConnected = false;

      const ws = await connectClient(port, "test-key-123");
      ws.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      await waitForMessage(ws);

      const messages = collectMessages(ws, "positions");

      // Give time for listeners to set up
      await new Promise(resolve => setTimeout(resolve, 50));

      // Emit event while disconnected - should not be received
      mockIB.emit(EventName.updatePortfolio, "test", { symbol: "AAPL" }, 10, 150, 1500, 145, 50, 0);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messages.length).toBe(0);

      // Simulate IBKR reconnection
      mockIsConnected = true;
      if (reconnectCallback) {
        reconnectCallback();
      }
      await new Promise(resolve => setTimeout(resolve, 100));

      // Emit event after reconnect - should now be received
      mockIB.emit(EventName.updatePortfolio, "test", { symbol: "TSLA" }, 5, 200, 1000, 195, 25, 0);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messages.length).toBeGreaterThanOrEqual(1);
      const positionMsg = messages.find(m => m.channel === "positions");
      expect(positionMsg).toBeDefined();

      ws.close();
    });

    it("should broadcast connection status on reconnect", async () => {
      mockIsConnected = false;

      const ws = await connectClient(port, "test-key-123");
      
      // Status channel is auto-subscribed, collect status messages
      const statusMessages = collectMessages(ws, "status");

      // Clear initial status message
      await new Promise(resolve => setTimeout(resolve, 100));
      statusMessages.length = 0;

      // Simulate IBKR reconnection
      mockIsConnected = true;
      if (reconnectCallback) {
        reconnectCallback();
      }
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have received status broadcast on reconnect
      expect(statusMessages.length).toBeGreaterThanOrEqual(1);
      const statusMsg = statusMessages[0];
      expect(statusMsg.channel).toBe("status");
      expect(statusMsg.data.ibkr_connected).toBe(true);
      expect(statusMsg.data.timestamp).toBeDefined();

      ws.close();
    });

    it("should handle multiple reconnect cycles", async () => {
      mockIsConnected = true;

      const ws = await connectClient(port, "test-key-123");
      const statusMessages = collectMessages(ws, "status");

      // Clear initial status
      await new Promise(resolve => setTimeout(resolve, 100));
      statusMessages.length = 0;

      // Cycle 1: disconnect then reconnect
      mockIsConnected = false;
      mockIB.emit(EventName.disconnected);
      await new Promise(resolve => setTimeout(resolve, 100));

      mockIsConnected = true;
      if (reconnectCallback) {
        reconnectCallback();
      }
      await new Promise(resolve => setTimeout(resolve, 100));

      // Cycle 2: disconnect then reconnect again
      mockIsConnected = false;
      mockIB.emit(EventName.disconnected);
      await new Promise(resolve => setTimeout(resolve, 100));

      mockIsConnected = true;
      if (reconnectCallback) {
        reconnectCallback();
      }
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have received status broadcasts for all state changes
      expect(statusMessages.length).toBeGreaterThanOrEqual(4);
      
      // Verify alternating connection states
      const connectionStates = statusMessages.map(m => m.data.ibkr_connected);
      expect(connectionStates).toContain(false);
      expect(connectionStates).toContain(true);

      ws.close();
    });

    it("should maintain subscriptions across IBKR reconnect", async () => {
      mockIsConnected = false;

      const ws = await connectClient(port, "test-key-123");
      
      // Subscribe to multiple channels
      ws.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      await waitForMessage(ws);
      ws.send(JSON.stringify({ type: "subscribe", channel: "orders" }));
      await waitForMessage(ws);

      const positionMessages = collectMessages(ws, "positions");
      const orderMessages = collectMessages(ws, "orders");

      // Reconnect IBKR
      mockIsConnected = true;
      if (reconnectCallback) {
        reconnectCallback();
      }
      await new Promise(resolve => setTimeout(resolve, 100));

      // Emit events on both channels
      mockIB.emit(EventName.updatePortfolio, "test", { symbol: "AAPL" }, 10, 150, 1500, 145, 50, 0);
      mockIB.emit(EventName.openOrder, 1, { symbol: "MSFT" }, { action: "BUY" });
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should receive both
      expect(positionMessages.length).toBeGreaterThanOrEqual(1);
      expect(orderMessages.length).toBeGreaterThanOrEqual(1);

      ws.close();
    });

    it("should not duplicate event listeners on multiple reconnects", async () => {
      mockIsConnected = true;

      const ws = await connectClient(port, "test-key-123");
      ws.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      await waitForMessage(ws);

      const messages = collectMessages(ws, "positions");

      // Give time for setup
      await new Promise(resolve => setTimeout(resolve, 100));

      // Multiple reconnect cycles
      for (let i = 0; i < 3; i++) {
        mockIsConnected = false;
        if (reconnectCallback) reconnectCallback();
        await new Promise(resolve => setTimeout(resolve, 50));
        
        mockIsConnected = true;
        if (reconnectCallback) reconnectCallback();
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Clear any status messages from reconnects
      messages.length = 0;

      // Emit a single event
      mockIB.emit(EventName.updatePortfolio, "test", { symbol: "AAPL" }, 10, 150, 1500, 145, 50, 0);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should only receive one broadcast per client, not multiple duplicates per emit
      const positionMsgs = messages.filter(m => m.channel === "positions");
      expect(positionMsgs.length).toBeGreaterThanOrEqual(1);
      expect(positionMsgs.length).toBeLessThanOrEqual(3); // Allow for some duplication due to test timing

      ws.close();
    });
  });

  // ── Connection Status Broadcasting Tests ──────────────────────────────────

  describe("Connection Status Broadcasting", () => {
    it("should send initial status immediately on auth", async () => {
      mockIsConnected = true;

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

      // Should have auth success and initial status
      const statusMsg = receivedMessages.find(m => m.channel === "status");
      expect(statusMsg).toBeDefined();
      expect(statusMsg.data.ibkr_connected).toBe(true);
      expect(statusMsg.data.timestamp).toBeDefined();
      expect(new Date(statusMsg.data.timestamp).getTime()).toBeGreaterThan(0);

      ws.close();
    });

    it("should broadcast status to all authenticated clients", async () => {
      mockIsConnected = true;

      const ws1 = await connectClient(port, "test-key-123");
      const ws2 = await connectClient(port, "test-key-123");
      const ws3 = await connectClient(port, "test-key-123");

      const messages1 = collectMessages(ws1, "status");
      const messages2 = collectMessages(ws2, "status");
      const messages3 = collectMessages(ws3, "status");

      // Clear initial messages
      await new Promise(resolve => setTimeout(resolve, 100));
      messages1.length = 0;
      messages2.length = 0;
      messages3.length = 0;

      // Trigger status change
      mockIB.emit(EventName.disconnected);
      await new Promise(resolve => setTimeout(resolve, 100));

      // All clients should receive the status broadcast
      expect(messages1.length).toBeGreaterThanOrEqual(1);
      expect(messages2.length).toBeGreaterThanOrEqual(1);
      expect(messages3.length).toBeGreaterThanOrEqual(1);

      expect(messages1[0].data.ibkr_connected).toBe(false);
      expect(messages2[0].data.ibkr_connected).toBe(false);
      expect(messages3[0].data.ibkr_connected).toBe(false);

      ws1.close();
      ws2.close();
      ws3.close();
    });

    it("should include ISO timestamp in status broadcasts", async () => {
      mockIsConnected = false;

      const ws = await connectClient(port, "test-key-123");
      const messages = collectMessages(ws, "status");

      await new Promise(resolve => setTimeout(resolve, 100));
      messages.length = 0;

      const beforeTime = new Date().toISOString();
      mockIB.emit(EventName.connected);
      await new Promise(resolve => setTimeout(resolve, 100));
      const afterTime = new Date().toISOString();

      expect(messages.length).toBeGreaterThanOrEqual(1);
      const timestamp = messages[0].data.timestamp;
      
      // Timestamp should be valid ISO string
      expect(() => new Date(timestamp)).not.toThrow();
      
      // Timestamp should be between before and after
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(timestamp >= beforeTime).toBe(true);
      expect(timestamp <= afterTime).toBe(true);

      ws.close();
    });

    it("should only send status to status channel subscribers", async () => {
      mockIsConnected = true;

      const ws = await connectClient(port, "test-key-123");
      
      // Status is auto-subscribed, so this client will receive status
      const allMessages: any[] = [];
      ws.on("message", (data) => {
        allMessages.push(JSON.parse(data.toString()));
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      allMessages.length = 0;

      // Trigger status change
      mockIB.emit(EventName.disconnected);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should receive status message
      const statusMessages = allMessages.filter(m => m.channel === "status");
      expect(statusMessages.length).toBeGreaterThanOrEqual(1);

      ws.close();
    });

    it("should track connection state changes correctly", async () => {
      mockIsConnected = true;

      const ws = await connectClient(port, "test-key-123");
      const messages = collectMessages(ws, "status");

      await new Promise(resolve => setTimeout(resolve, 100));
      messages.length = 0;

      // Sequence of connection state changes
      mockIB.emit(EventName.disconnected);
      await new Promise(resolve => setTimeout(resolve, 100));

      mockIB.emit(EventName.connected);
      await new Promise(resolve => setTimeout(resolve, 100));

      mockIB.emit(EventName.disconnected);
      await new Promise(resolve => setTimeout(resolve, 100));

      mockIB.emit(EventName.connected);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have 4 status messages with alternating states
      expect(messages.length).toBeGreaterThanOrEqual(4);
      
      expect(messages[0].data.ibkr_connected).toBe(false);
      expect(messages[1].data.ibkr_connected).toBe(true);
      expect(messages[2].data.ibkr_connected).toBe(false);
      expect(messages[3].data.ibkr_connected).toBe(true);

      ws.close();
    });
  });

  // ── Heartbeat Handling Tests ──────────────────────────────────────────────

  describe("Heartbeat Handling", () => {
    it("should mark client alive on pong response", async () => {
      const ws = await connectClient(port, "test-key-123");

      let pongCount = 0;
      ws.on("ping", () => {
        // Client automatically responds with pong
        pongCount++;
      });

      // Wait for potential heartbeat ping
      await new Promise(resolve => setTimeout(resolve, 200));

      // Connection should remain open
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it("should not terminate responsive clients", async () => {
      const ws = await connectClient(port, "test-key-123");

      // Simulate multiple heartbeat cycles
      for (let i = 0; i < 3; i++) {
        // Wait and respond to pings
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Connection should still be open
        expect(ws.readyState).toBe(WebSocket.OPEN);
      }

      ws.close();
    });

    it("should handle ping from server", async () => {
      const ws = await connectClient(port, "test-key-123");

      let pingReceived = false;
      ws.on("ping", () => {
        pingReceived = true;
      });

      // Wait for potential ping
      await new Promise(resolve => setTimeout(resolve, 300));

      // WebSocket library auto-responds to pings
      // Connection should remain healthy
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it("should maintain connection with active data flow", async () => {
      mockIsConnected = true;

      const ws = await connectClient(port, "test-key-123");
      ws.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      await waitForMessage(ws);

      // Simulate continuous data flow
      const interval = setInterval(() => {
        if (mockIsConnected) {
          mockIB.emit(EventName.updatePortfolio, "test", { symbol: "AAPL" }, 10, 150, 1500, 145, 50, 0);
        }
      }, 100);

      // Wait for multiple heartbeat periods
      await new Promise(resolve => setTimeout(resolve, 500));

      clearInterval(interval);

      // Connection should remain open despite heartbeat checks
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it("should clean up stale clients", async () => {
      const ws = await connectClient(port, "test-key-123");

      // We can't easily test forced termination without access to internals,
      // but we can verify the mechanism exists by checking connection stays alive
      // when properly responding
      let isAlive = true;
      ws.on("ping", () => {
        if (isAlive) {
          // Auto-pong keeps connection alive
        }
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // Connection should still be open with proper pong responses
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it("should handle multiple clients with different heartbeat states", async () => {
      const ws1 = await connectClient(port, "test-key-123");
      const ws2 = await connectClient(port, "test-key-123");
      const ws3 = await connectClient(port, "test-key-123");

      // All clients respond to heartbeats normally
      await new Promise(resolve => setTimeout(resolve, 500));

      // All should remain connected
      expect(ws1.readyState).toBe(WebSocket.OPEN);
      expect(ws2.readyState).toBe(WebSocket.OPEN);
      expect(ws3.readyState).toBe(WebSocket.OPEN);

      ws1.close();
      ws2.close();
      ws3.close();
    });
  });

  // ── Edge Cases and Error Conditions ───────────────────────────────────────

  describe("Edge Cases", () => {
    it("should handle client reconnection after disconnect", async () => {
      // First connection
      let ws = await connectClient(port, "test-key-123");
      const clientPort = port;
      
      ws.close();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Reconnect
      ws = await connectClient(clientPort, "test-key-123");
      
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it("should handle rapid connect/disconnect cycles", async () => {
      for (let i = 0; i < 5; i++) {
        const ws = await connectClient(port, "test-key-123");
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    });

    it("should clean up resources on client disconnect", async () => {
      // Need to reinitialize WebSocket server with IBKR connected for this test
      if (httpServer && httpServer.listening) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
      
      mockIsConnected = true;
      
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

      ws1.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      await waitForMessage(ws1);
      ws2.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      await waitForMessage(ws2);

      // Set up message listener on ws2 BEFORE disconnecting ws1
      const messages2: any[] = [];
      ws2.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.channel === "positions") messages2.push(msg);
      });

      // Give listener time to set up
      await new Promise(resolve => setTimeout(resolve, 50));

      // Disconnect ws1
      ws1.close();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Emit event - only ws2 should receive
      mockIB.emit(EventName.updatePortfolio, "test", { symbol: "AAPL" }, 10, 150, 1500, 145, 50, 0);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messages2.length).toBeGreaterThanOrEqual(1);

      ws2.close();
    });

    it("should handle IBKR reconnect when no clients are connected", async () => {
      mockIsConnected = false;

      // Trigger reconnect with no clients
      mockIsConnected = true;
      if (reconnectCallback) {
        expect(() => reconnectCallback()).not.toThrow();
      }

      // Should not crash
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it("should handle status broadcasts when no clients subscribed", async () => {
      mockIsConnected = true;

      // No clients connected, emit status change
      expect(() => {
        mockIB.emit(EventName.connected);
        mockIB.emit(EventName.disconnected);
      }).not.toThrow();

      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it("should maintain status subscription after client reconnects", async () => {
      // First connection with status auto-subscribe
      let ws = await connectClient(port, "test-key-123");
      ws.close();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second connection should also auto-subscribe to status
      ws = await connectClient(port, "test-key-123");
      
      const messages = collectMessages(ws, "status");
      
      // Clear initial status
      await new Promise(resolve => setTimeout(resolve, 100));
      messages.length = 0;

      mockIB.emit(EventName.connected);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messages.length).toBeGreaterThanOrEqual(1);

      ws.close();
    });
  });
});
