/**
 * E2E smoke tests for bridge startup and core API endpoints.
 * Tests the bridge in REST-only mode with IBKR disabled.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startBridge, stopBridge, waitForReady, type BridgeProcess } from "./helpers.js";

describe("E2E Smoke Tests", () => {
  let bridge: BridgeProcess;
  let baseUrl: string;
  let headers: Record<string, string>;

  // Setup: start bridge and wait for readiness
  beforeAll(async () => {
    bridge = await startBridge();
    await waitForReady(bridge.port, bridge.apiKey, 30_000);

    baseUrl = `http://localhost:${bridge.port}`;
    headers = { "X-API-Key": bridge.apiKey, "Content-Type": "application/json" };
  }, 35_000); // 35s timeout for startup + readiness

  // Teardown: stop bridge
  afterAll(async () => {
    if (bridge) {
      await stopBridge(bridge);
    }
  }, 10_000);

  it("GET /api/status returns 200 with connection status", async () => {
    const response = await fetch(`${baseUrl}/api/status`, { headers });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("status");
    expect(data).toHaveProperty("easternTime");
    expect(data).toHaveProperty("marketSession");
    expect(data).toHaveProperty("timestamp");
    expect(typeof data.status).toBe("string");
  }, 5_000);

  it("POST /api/agent { action: 'get_status' } returns 200", async () => {
    const response = await fetch(`${baseUrl}/api/agent`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "get_status" }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("result");
    expect(data.result).toHaveProperty("easternTime");
    expect(data.result).toHaveProperty("marketSession");
  }, 5_000);

  it("POST /api/agent { action: 'get_quote', params: { symbol: 'AAPL' } } returns 200 or handles error gracefully", async () => {
    const response = await fetch(`${baseUrl}/api/agent`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "get_quote",
        params: { symbol: "AAPL" },
      }),
    });

    // Accept 200 (success) or 500 (Yahoo API error - expected without proper rate limiting)
    expect([200, 500]).toContain(response.status);

    const data = await response.json();
    if (response.status === 200) {
      expect(data).toHaveProperty("result");
      expect(data.result).toHaveProperty("symbol");
      expect(data.result.symbol).toBe("AAPL");
      expect(data.result).toHaveProperty("source");
    } else {
      // 500 error should have error message
      expect(data).toHaveProperty("error");
      expect(typeof data.error).toBe("string");
    }
  }, 5_000);

  it("POST /api/agent { action: 'holly_stats' } returns 200", async () => {
    const response = await fetch(`${baseUrl}/api/agent`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "holly_stats" }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("result");
    // Holly stats should return an object with numeric stats
    expect(typeof data.result).toBe("object");
  }, 5_000);

  it("POST /api/agent { action: 'unknown' } returns 400", async () => {
    const response = await fetch(`${baseUrl}/api/agent`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "unknown_action_does_not_exist" }),
    });

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data).toHaveProperty("error");
    expect(typeof data.error).toBe("string");
  }, 5_000);

  it("GET /api/agent/catalog returns 200", async () => {
    const response = await fetch(`${baseUrl}/api/agent/catalog`, { headers });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(typeof data).toBe("object");
    expect(Object.keys(data).length).toBeGreaterThan(0);

    // Validate structure of first action metadata
    const firstKey = Object.keys(data)[0];
    const firstMeta = data[firstKey];
    expect(firstMeta).toHaveProperty("description");
    expect(typeof firstMeta.description).toBe("string");
  }, 5_000);
});
