import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ibkr/connection.js", async () => {
  const actual = await vi.importActual<typeof import("../ibkr/connection.js")>("../ibkr/connection.js");
  return {
    ...actual,
    getConnectionStatus: vi.fn(() => ({ connected: true })),
  };
});

describe("IBKR connection resilience", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T14:30:00.000Z"));
    vi.resetModules();
  });

  it("uses 3-strike heartbeat actions", async () => {
    const { __test } = await import("../ibkr/connection.js");

    expect(__test.getHeartbeatAction(1)).toBe("warning");
    expect(__test.getHeartbeatAction(2)).toBe("soft_reconnect");
    expect(__test.getHeartbeatAction(3)).toBe("hard_reconnect");
    expect(__test.getHeartbeatAction(4)).toBe("hard_reconnect");
  });

  it("uses exponential reconnect backoff sequence", async () => {
    const { __test } = await import("../ibkr/connection.js");

    expect(__test.getReconnectBaseDelayMs(0)).toBe(2_000);
    expect(__test.getReconnectBaseDelayMs(1)).toBe(4_000);
    expect(__test.getReconnectBaseDelayMs(2)).toBe(8_000);
    expect(__test.getReconnectBaseDelayMs(3)).toBe(16_000);
    expect(__test.getReconnectBaseDelayMs(4)).toBe(30_000);
    expect(__test.getReconnectBaseDelayMs(7)).toBe(30_000);
  });

  it("detects TWS restart-specific reconnect delays", async () => {
    const { __test } = await import("../ibkr/connection.js");

    expect(__test.getErrorReconnectDelayMs(1100)).toBe(10_000);
    expect(__test.getErrorReconnectDelayMs(504)).toBeUndefined();
    expect(__test.getErrorReconnectDelayMs(1102)).toBeNull();
  });

  it("computes connection health score from uptime, latency and reconnect count", async () => {
    const metricsModule = await import("../ops/metrics.js");
    metricsModule.__test.resetConnectionHealthData();

    metricsModule.__test.updateIbkrAvailability(true);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    metricsModule.__test.updateIbkrAvailability(true);

    metricsModule.recordHeartbeatLatency(100);
    metricsModule.recordHeartbeatLatency(150);
    metricsModule.recordHeartbeatLatency(200);

    metricsModule.recordReconnectStart();
    metricsModule.recordReconnectStart();

    const health = metricsModule.getConnectionHealth();

    expect(health.uptimePercentLastHour).toBeGreaterThanOrEqual(99);
    expect(health.heartbeatP95Ms).toBe(200);
    expect(health.reconnectCountLastHour).toBe(2);
    expect(health.score).toBeGreaterThan(70);
    expect(health.score).toBeLessThanOrEqual(100);
  });
});
