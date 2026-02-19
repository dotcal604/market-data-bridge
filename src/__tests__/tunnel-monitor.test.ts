import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkTunnelHealth, getTunnelMetrics, resetTunnelState } from "../ops/tunnel-monitor.js";

// Mock fetch globally
global.fetch = vi.fn();

// Mock child_process exec
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

// Mock promisify
vi.mock("node:util", () => ({
  promisify: vi.fn((fn) => fn),
}));

// Mock metrics incident recording
vi.mock("../ops/metrics.js", () => ({
  recordIncident: vi.fn(),
}));

// Mock logger
vi.mock("../logging.js", () => ({
  logger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

describe("Tunnel Monitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetTunnelState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("checkTunnelHealth()", () => {
    it("should record successful health check", async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);

      await checkTunnelHealth();

      const metrics = getTunnelMetrics();
      expect(metrics.tunnelConnected).toBe(true);
      expect(metrics.tunnelConsecutiveFailures).toBe(0);
      expect(metrics.tunnelLastProbeTimestamp).toBeTruthy();
    });

    it("should track latency on successful probe", async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);

      await checkTunnelHealth();

      const metrics = getTunnelMetrics();
      expect(metrics.tunnelLastProbeLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should increment consecutive failures on HTTP error", async () => {
      const mockFetch = vi.mocked(global.fetch);
      const { recordIncident } = await import("../ops/metrics.js");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
      } as Response);

      await checkTunnelHealth();

      const metrics = getTunnelMetrics();
      expect(metrics.tunnelConnected).toBe(false);
      expect(metrics.tunnelConsecutiveFailures).toBe(1);
      expect(recordIncident).toHaveBeenCalledWith(
        "tunnel_failure",
        "warning",
        expect.stringContaining("Bad Gateway"),
      );
    });

    it("should increment consecutive failures on network error", async () => {
      const mockFetch = vi.mocked(global.fetch);
      const { recordIncident } = await import("../ops/metrics.js");

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await checkTunnelHealth();

      const metrics = getTunnelMetrics();
      expect(metrics.tunnelConnected).toBe(false);
      expect(metrics.tunnelConsecutiveFailures).toBe(1);
      expect(recordIncident).toHaveBeenCalledWith(
        "tunnel_failure",
        "warning",
        expect.stringContaining("Network error"),
      );
    });

    it("should handle fetch timeout", async () => {
      const mockFetch = vi.mocked(global.fetch);

      // Simulate what happens when AbortController triggers due to timeout
      mockFetch.mockRejectedValueOnce((() => {
        const error: any = new Error("Aborted");
        error.name = "AbortError";
        return error;
      })());

      await checkTunnelHealth();

      const metrics = getTunnelMetrics();
      expect(metrics.tunnelConnected).toBe(false);
    });

    it("should reset consecutive failures after successful probe", async () => {
      const mockFetch = vi.mocked(global.fetch);

      // First failure
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      await checkTunnelHealth();
      expect(getTunnelMetrics().tunnelConsecutiveFailures).toBe(1);

      // Second failure
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      await checkTunnelHealth();
      expect(getTunnelMetrics().tunnelConsecutiveFailures).toBe(2);

      // Success — should reset
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);
      await checkTunnelHealth();
      expect(getTunnelMetrics().tunnelConsecutiveFailures).toBe(0);
    });

    it("should attempt restart after 3 consecutive failures", async () => {
      const mockFetch = vi.mocked(global.fetch);
      const { exec } = await import("node:child_process");
      const mockExec = vi.mocked(exec);
      const { recordIncident } = await import("../ops/metrics.js");

      // Mock Windows service check (sc query) and restart
      mockExec.mockImplementation((cmd: string, opts: any, callback: any) => {
        if (cmd.includes("sc query")) {
          callback(null, { stdout: "SERVICE_NAME: cloudflared\nSTATE: RUNNING" });
        } else if (cmd.includes("sc stop")) {
          callback(null, { stdout: "SUCCESS" });
        } else if (cmd.includes("sc start")) {
          callback(null, { stdout: "SUCCESS" });
        } else {
          callback(new Error("Unknown command"));
        }
      });

      // Three consecutive failures
      for (let i = 0; i < 3; i++) {
        mockFetch.mockRejectedValueOnce(new Error("Network error"));
        await checkTunnelHealth();
      }

      // Should have attempted restart
      const metrics = getTunnelMetrics();
      expect(metrics.tunnelRestartAttempts).toBeGreaterThan(0);
      expect(recordIncident).toHaveBeenCalledWith(
        expect.stringMatching(/tunnel_restart/),
        expect.any(String),
        expect.any(String),
      );
    });

    it("should record critical incident on restart failure threshold", async () => {
      const mockFetch = vi.mocked(global.fetch);
      const { recordIncident } = await import("../ops/metrics.js");

      // Three failures (hitting threshold)
      for (let i = 0; i < 3; i++) {
        mockFetch.mockRejectedValueOnce(new Error("Network error"));
        await checkTunnelHealth();
      }

      // Should have recorded at least one critical incident
      expect(recordIncident).toHaveBeenCalledWith(
        expect.any(String),
        "critical",
        expect.any(String),
      );
    });
  });

  describe("getTunnelMetrics()", () => {
    it("should return tunnel metrics with default values", () => {
      const metrics = getTunnelMetrics();

      expect(metrics).toHaveProperty("tunnelUptimePercent");
      expect(metrics).toHaveProperty("tunnelLastProbeLatencyMs");
      expect(metrics).toHaveProperty("tunnelConsecutiveFailures");
      expect(metrics).toHaveProperty("tunnelRestartAttempts");
      expect(metrics).toHaveProperty("tunnelLastProbeTimestamp");
      expect(metrics).toHaveProperty("tunnelUrl");
      expect(metrics).toHaveProperty("tunnelConnected");

      expect(typeof metrics.tunnelUptimePercent).toBe("number");
      expect(typeof metrics.tunnelLastProbeLatencyMs).toBe("number");
      expect(typeof metrics.tunnelConsecutiveFailures).toBe("number");
      expect(typeof metrics.tunnelRestartAttempts).toBe("number");
      expect(typeof metrics.tunnelUrl).toBe("string");
      expect(typeof metrics.tunnelConnected).toBe("boolean");
    });

    it("should calculate uptime percentage correctly", async () => {
      const mockFetch = vi.mocked(global.fetch);

      // Multiple successes to build up connected time
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce({ ok: true } as Response);
        await checkTunnelHealth();
        await vi.advanceTimersByTimeAsync(60_000);
      }

      const metrics = getTunnelMetrics();
      // Should have high uptime after several consecutive successes
      expect(metrics.tunnelUptimePercent).toBeGreaterThan(90);
    });

    it("should track tunnel URL from environment", () => {
      const metrics = getTunnelMetrics();
      // Default should be api.klfh-dot-io.com
      expect(metrics.tunnelUrl).toContain("api.klfh-dot-io.com");
    });
  });
});
