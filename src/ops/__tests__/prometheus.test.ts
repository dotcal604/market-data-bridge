import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpsMetrics } from "../metrics.js";

// ── Mock getMetrics before importing the module under test ───────────

function makeMockMetrics(overrides: Partial<OpsMetrics> = {}): OpsMetrics {
  return {
    startedAt: "2025-01-01T00:00:00.000Z",
    uptimeSeconds: 3600,
    memoryMb: { heapUsed: 120.5, heapTotal: 200.0, rss: 350.2 },
    cpuPercent: 12.3,

    ibkrConnected: true,
    ibkrUptimePercent: 99.5,
    ibkrDisconnects: 3,
    ibkrReconnectAttempts: 5,
    ibkrCurrentStreakSeconds: 1800,

    tunnelConnected: true,
    tunnelUptimePercent: 98.7,
    tunnelLastProbeLatencyMs: 42,
    tunnelConsecutiveFailures: 0,
    tunnelRestartAttempts: 1,
    tunnelLastProbeTimestamp: "2025-01-01T00:59:00.000Z",
    tunnelUrl: "https://tunnel.example.com",

    requests: {
      total: 500,
      windowCount: 80,
      windowErrors: 2,
      errorRate: 2.5,
      avgLatencyMs: 45,
      p50LatencyMs: 30,
      p95LatencyMs: 120,
      p99LatencyMs: 250,
    },

    mcpSessions: {
      total: 10,
      active: 2,
      avgDurationSeconds: 300,
      totalToolCalls: 150,
    },

    incidentCount: 7,
    unhandledRejections: 0,
    lastIncident: null,

    sla: {
      last_1h: { bridge_pct: 100, ibkr_pct: 99.5, tunnel_pct: 98.7, end_to_end_pct: 97.2 },
      last_24h: { bridge_pct: 99.9, ibkr_pct: 98.0, tunnel_pct: 97.5, end_to_end_pct: 95.1 },
    },

    ...overrides,
  };
}

vi.mock("../metrics.js", () => ({
  getMetrics: vi.fn(() => makeMockMetrics()),
}));

import { getMetrics } from "../metrics.js";
import {
  collectMetrics,
  getPrometheusContentType,
  observeHttpRequest,
} from "../prometheus.js";

// ── Helpers ──────────────────────────────────────────────────────────

/** Parse a specific metric value from Prometheus text output. */
function parseMetricValue(output: string, name: string, labels?: string): number | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labelPart = labels ? `\\{${labels.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}` : "";
  const re = new RegExp(`^${escapedName}${labelPart}\\s+([\\d.eE+-]+)`, "m");
  const match = output.match(re);
  return match ? Number(match[1]) : undefined;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Prometheus metrics bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getMetrics as ReturnType<typeof vi.fn>).mockReturnValue(makeMockMetrics());
  });

  it("collectMetrics() returns valid Prometheus exposition text", async () => {
    const output = await collectMetrics();
    expect(output).toContain("# HELP");
    expect(output).toContain("# TYPE");
    // Should be non-empty text
    expect(output.length).toBeGreaterThan(100);
  });

  it("metric names follow naming conventions", async () => {
    const output = await collectMetrics();
    expect(output).toContain("bridge_uptime_seconds");
    expect(output).toContain("bridge_memory_bytes");
    expect(output).toContain("bridge_cpu_percent");
    expect(output).toContain("ibkr_connected");
    expect(output).toContain("ibkr_uptime_percent");
    expect(output).toContain("tunnel_connected");
    expect(output).toContain("tunnel_uptime_percent");
    expect(output).toContain("mcp_sessions_total");
    expect(output).toContain("mcp_sessions_active");
    expect(output).toContain("sla_end_to_end_percent");
    expect(output).toContain("bridge_incidents_total");
    expect(output).toContain("http_requests_total");
    expect(output).toContain("http_request_duration_ms");
  });

  it("memory metrics use bytes labels", async () => {
    const output = await collectMetrics();
    expect(output).toContain('bridge_memory_bytes{type="heap_used"}');
    expect(output).toContain('bridge_memory_bytes{type="heap_total"}');
    expect(output).toContain('bridge_memory_bytes{type="rss"}');

    // Verify conversion from MB to bytes (120.5 MB = 120.5 * 1024 * 1024)
    const heapUsedBytes = parseMetricValue(output, "bridge_memory_bytes", 'type="heap_used"');
    expect(heapUsedBytes).toBeDefined();
    expect(heapUsedBytes).toBeCloseTo(120.5 * 1024 * 1024, -1);
  });

  it("ibkr_connected is 1 when connected", async () => {
    const output = await collectMetrics();
    const value = parseMetricValue(output, "ibkr_connected");
    expect(value).toBe(1);
  });

  it("ibkr_connected is 0 when disconnected", async () => {
    (getMetrics as ReturnType<typeof vi.fn>).mockReturnValue(
      makeMockMetrics({ ibkrConnected: false }),
    );
    const output = await collectMetrics();
    const value = parseMetricValue(output, "ibkr_connected");
    expect(value).toBe(0);
  });

  it("observeHttpRequest increments counter and records histogram", async () => {
    observeHttpRequest(200, 55);
    observeHttpRequest(200, 120);
    observeHttpRequest(404, 10);

    const output = await collectMetrics();

    // Counter should have status_code labels
    expect(output).toContain('http_requests_total{status_code="200"}');
    expect(output).toContain('http_requests_total{status_code="404"}');

    // 200 should have been incremented twice
    const count200 = parseMetricValue(output, "http_requests_total", 'status_code="200"');
    expect(count200).toBe(2);

    const count404 = parseMetricValue(output, "http_requests_total", 'status_code="404"');
    expect(count404).toBe(1);
  });

  it("histogram has correct buckets", async () => {
    observeHttpRequest(200, 75);
    const output = await collectMetrics();

    // Verify standard bucket boundaries appear
    expect(output).toContain('http_request_duration_ms_bucket{le="10"');
    expect(output).toContain('http_request_duration_ms_bucket{le="50"');
    expect(output).toContain('http_request_duration_ms_bucket{le="100"');
    expect(output).toContain('http_request_duration_ms_bucket{le="250"');
    expect(output).toContain('http_request_duration_ms_bucket{le="500"');
    expect(output).toContain('http_request_duration_ms_bucket{le="1000"');
    expect(output).toContain('http_request_duration_ms_bucket{le="2500"');
    expect(output).toContain('http_request_duration_ms_bucket{le="+Inf"');
  });

  it("handles missing SLA data gracefully", async () => {
    (getMetrics as ReturnType<typeof vi.fn>).mockReturnValue(
      makeMockMetrics({ sla: undefined }),
    );

    // Should not throw
    const output = await collectMetrics();
    expect(output).toBeDefined();
    expect(output).toContain("bridge_uptime_seconds");
    // SLA help/type lines still registered, but no sample lines with window labels
    // (prom-client still emits HELP/TYPE for registered metrics even without values)
  });

  it("getPrometheusContentType() returns a valid content type", () => {
    const ct = getPrometheusContentType();
    expect(ct).toBeDefined();
    expect(ct).toContain("text/");
  });

  it("snapshot gauges reflect mock values", async () => {
    const output = await collectMetrics();

    expect(parseMetricValue(output, "bridge_uptime_seconds")).toBe(3600);
    expect(parseMetricValue(output, "bridge_cpu_percent")).toBe(12.3);
    expect(parseMetricValue(output, "ibkr_uptime_percent")).toBe(99.5);
    expect(parseMetricValue(output, "ibkr_disconnects_total")).toBe(3);
    expect(parseMetricValue(output, "ibkr_reconnect_attempts_total")).toBe(5);
    expect(parseMetricValue(output, "tunnel_connected")).toBe(1);
    expect(parseMetricValue(output, "tunnel_uptime_percent")).toBe(98.7);
    expect(parseMetricValue(output, "tunnel_probe_latency_ms")).toBe(42);
    expect(parseMetricValue(output, "mcp_sessions_total")).toBe(10);
    expect(parseMetricValue(output, "mcp_sessions_active")).toBe(2);
    expect(parseMetricValue(output, "mcp_tool_calls_total")).toBe(150);
    expect(parseMetricValue(output, "bridge_incidents_total")).toBe(7);
    expect(parseMetricValue(output, "sla_end_to_end_percent", 'window="1h"')).toBe(97.2);
    expect(parseMetricValue(output, "sla_end_to_end_percent", 'window="24h"')).toBe(95.1);
  });
});
