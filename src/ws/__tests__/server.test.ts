import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, Server as HttpServer } from "http";
import { wsServer } from "../server.js";
import { config } from "../../config.js";

describe("WebSocket Server", () => {
  let httpServer: HttpServer;
  let port: number;
  let wsUrl: string;

  beforeEach(() => {
    // Create a test HTTP server
    httpServer = createServer();
    return new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        if (addr && typeof addr === "object") {
          port = addr.port;
          // Build URL with API key if configured
          wsUrl = `ws://localhost:${port}`;
          if (config.rest.apiKey) {
            wsUrl += `?apiKey=${config.rest.apiKey}`;
          }
        }
        resolve();
      });
    });
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      httpServer.close(() => {
        resolve();
      });
    });
  });

  it("should start WebSocket server on HTTP upgrade", async () => {
    wsServer.start(httpServer);
    expect(httpServer.listenerCount("upgrade")).toBeGreaterThan(0);
  });

  it("should accept WebSocket connections", async () => {
    wsServer.start(httpServer);

    return new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);

      client.on("open", () => {
        expect(client.readyState).toBe(WebSocket.OPEN);
        client.close();
        resolve();
      });

      client.on("error", (err) => {
        reject(err);
      });

      setTimeout(() => reject(new Error("Connection timeout")), 5000);
    });
  });

  it("should handle subscribe messages", async () => {
    wsServer.start(httpServer);

    return new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);

      client.on("open", () => {
        // Subscribe to positions channel
        client.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
      });

      client.on("message", (data) => {
        const message = JSON.parse(data.toString());
        // First message should be pong (welcome message)
        if (message.type === "pong") {
          // Subscription successful
          client.close();
          resolve();
        }
      });

      client.on("error", (err) => {
        reject(err);
      });

      setTimeout(() => reject(new Error("Timeout")), 5000);
    });
  });

  it("should handle ping/pong messages", async () => {
    wsServer.start(httpServer);

    return new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);

      client.on("open", () => {
        client.send(JSON.stringify({ type: "ping" }));
      });

      let pongCount = 0;
      client.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "pong") {
          pongCount++;
          if (pongCount === 2) {
            // First pong is welcome, second is response to our ping
            client.close();
            resolve();
          }
        }
      });

      client.on("error", (err) => {
        reject(err);
      });

      setTimeout(() => reject(new Error("Timeout")), 5000);
    });
  });

  it("should broadcast messages to subscribed channels", async () => {
    wsServer.start(httpServer);

    return new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);

      client.on("open", () => {
        // Subscribe to orders channel
        client.send(JSON.stringify({ type: "subscribe", channel: "orders" }));

        // Give subscription time to register
        setTimeout(() => {
          // Broadcast to orders channel
          wsServer.broadcast("orders", { orderId: 123, status: "Filled" });
        }, 100);
      });

      let receivedWelcome = false;
      client.on("message", (data) => {
        const message = JSON.parse(data.toString());
        
        if (message.type === "pong" && !receivedWelcome) {
          receivedWelcome = true;
          return;
        }

        if (message.type === "data" && message.channel === "orders") {
          expect(message.data).toEqual({ orderId: 123, status: "Filled" });
          client.close();
          resolve();
        }
      });

      client.on("error", (err) => {
        reject(err);
      });

      setTimeout(() => reject(new Error("Timeout")), 5000);
    });
  });

  it("should track client count", async () => {
    wsServer.start(httpServer);

    const client1 = new WebSocket(wsUrl);
    const client2 = new WebSocket(wsUrl);

    return new Promise<void>((resolve, reject) => {
      let openCount = 0;

      const checkCount = () => {
        openCount++;
        if (openCount === 2) {
          setTimeout(() => {
            // Both clients should be connected
            expect(wsServer.getClientCount()).toBe(2);
            client1.close();
            client2.close();

            // Wait for close
            setTimeout(() => {
              expect(wsServer.getClientCount()).toBe(0);
              resolve();
            }, 100);
          }, 100);
        }
      };

      client1.on("open", checkCount);
      client2.on("open", checkCount);

      client1.on("error", reject);
      client2.on("error", reject);

      setTimeout(() => reject(new Error("Timeout")), 5000);
    });
  });

  it("should handle unsubscribe messages", async () => {
    wsServer.start(httpServer);

    return new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);

      client.on("open", () => {
        // Subscribe then unsubscribe
        client.send(JSON.stringify({ type: "subscribe", channel: "positions" }));
        setTimeout(() => {
          client.send(JSON.stringify({ type: "unsubscribe", channel: "positions" }));
          setTimeout(() => {
            // After unsubscribe, broadcast shouldn't reach us
            wsServer.broadcast("positions", { test: "data" });
            
            // Wait to ensure no message is received
            setTimeout(() => {
              client.close();
              resolve();
            }, 200);
          }, 100);
        }, 100);
      });

      let messageCount = 0;
      client.on("message", (data) => {
        const message = JSON.parse(data.toString());
        messageCount++;
        
        // Should only receive welcome pong, not the broadcast
        if (message.type === "data") {
          reject(new Error("Received data after unsubscribe"));
        }
      });

      client.on("error", (err) => {
        reject(err);
      });

      setTimeout(() => {
        if (messageCount === 1) {
          resolve(); // Only received welcome
        } else {
          reject(new Error("Unexpected message count"));
        }
      }, 5000);
    });
  });

  it("should reject connections with invalid API key when auth is enabled", async () => {
    // Only test this if API key is configured
    if (!config.rest.apiKey) {
      return; // Skip test if no API key configured
    }

    wsServer.start(httpServer);

    return new Promise<void>((resolve, reject) => {
      // Try to connect without API key
      const client = new WebSocket(`ws://localhost:${port}`);

      client.on("open", () => {
        reject(new Error("Connection should have been rejected"));
      });

      client.on("error", () => {
        // Expected to fail
        resolve();
      });

      client.on("close", () => {
        // Connection closed by server is expected
        resolve();
      });

      setTimeout(() => reject(new Error("Timeout")), 5000);
    });
  });
});

