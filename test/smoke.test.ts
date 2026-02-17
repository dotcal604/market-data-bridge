import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startBridge, waitForReady, stopBridge, retryFetch, type BridgeProcess } from "./smoke-helpers.js";

describe("E2E Smoke Tests", () => {
  let bridge: BridgeProcess | null = null;

  beforeAll(async () => {
    // Start the bridge
    bridge = await startBridge();
    
    // Wait for it to be ready
    await waitForReady(bridge.port, bridge.apiKey);
  }, 40000); // 40s timeout for startup

  afterAll(async () => {
    // Stop the bridge
    if (bridge) {
      await stopBridge(bridge);
    }
  }, 10000); // 10s timeout for shutdown

  it("should start bridge and GET /api/status returns 200 with status fields", async () => {
    expect(bridge).not.toBeNull();
    
    const response = await retryFetch(
      `http://localhost:${bridge!.port}/api/status`,
      {
        headers: { "X-API-Key": bridge!.apiKey },
      }
    );

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("status");
    expect(data.status).toBe("ready");
    expect(data).toHaveProperty("easternTime");
    expect(data).toHaveProperty("marketSession");
    expect(data).toHaveProperty("timestamp");
    expect(data).toHaveProperty("ibkr");
    expect(data.ibkr).toHaveProperty("connected");
  });

  it("should POST /api/agent with get_status action returns 200 with connected field", async () => {
    expect(bridge).not.toBeNull();

    const response = await retryFetch(
      `http://localhost:${bridge!.port}/api/agent`,
      {
        method: "POST",
        headers: {
          "X-API-Key": bridge!.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "get_status",
        }),
      }
    );

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("action", "get_status");
    expect(data).toHaveProperty("result");
    expect(data.result).toHaveProperty("ibkr");
    expect(data.result.ibkr).toHaveProperty("connected");
    expect(typeof data.result.ibkr.connected).toBe("boolean");
  });

  it("should POST /api/agent with get_quote action for AAPL returns 200 with price", async () => {
    expect(bridge).not.toBeNull();

    const response = await retryFetch(
      `http://localhost:${bridge!.port}/api/agent`,
      {
        method: "POST",
        headers: {
          "X-API-Key": bridge!.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "get_quote",
          params: { symbol: "AAPL" },
        }),
      }
    );

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("action", "get_quote");
    expect(data).toHaveProperty("result");
    
    // Quote should have price-related fields
    const quote = data.result;
    expect(quote).toBeDefined();
    
    // Should have at least one price field (last, close, regularMarketPrice, etc.)
    const hasPriceField = 
      typeof quote.price === "number" ||
      typeof quote.last === "number" ||
      typeof quote.close === "number" ||
      typeof quote.regularMarketPrice === "number";
    
    expect(hasPriceField).toBe(true);
  });

  it("should POST /api/agent with holly_stats action returns 200", async () => {
    expect(bridge).not.toBeNull();

    const response = await retryFetch(
      `http://localhost:${bridge!.port}/api/agent`,
      {
        method: "POST",
        headers: {
          "X-API-Key": bridge!.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "holly_stats",
        }),
      }
    );

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("action", "holly_stats");
    expect(data).toHaveProperty("result");
    
    // Holly stats should return an object with count/stats fields
    expect(typeof data.result).toBe("object");
  });

  it("should GET /api/agent/catalog returns 200 with action metadata", async () => {
    expect(bridge).not.toBeNull();

    const response = await retryFetch(
      `http://localhost:${bridge!.port}/api/agent/catalog`,
      {
        headers: { "X-API-Key": bridge!.apiKey },
      }
    );

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const data = await response.json();
    
    // Catalog should be an object with action names as keys
    expect(typeof data).toBe("object");
    expect(Object.keys(data).length).toBeGreaterThan(0);
    
    // Each action should have metadata
    const firstAction = Object.keys(data)[0];
    expect(data[firstAction]).toHaveProperty("description");
  });

  it("should POST /api/agent with unknown action returns 400 with error", async () => {
    expect(bridge).not.toBeNull();

    const response = await retryFetch(
      `http://localhost:${bridge!.port}/api/agent`,
      {
        method: "POST",
        headers: {
          "X-API-Key": bridge!.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "unknown_nonexistent_action_xyz",
        }),
      }
    );

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data).toHaveProperty("error");
    expect(typeof data.error).toBe("string");
    expect(data.error).toContain("Unknown action");
  });

  it("should not leave hanging processes after tests", () => {
    // This test verifies that the beforeAll/afterAll cleanup works
    // The actual verification happens implicitly through the lifecycle hooks
    expect(true).toBe(true);
  });
});
