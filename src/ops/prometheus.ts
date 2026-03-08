/**
 * Prometheus metrics bridge.
 *
 * Translates the existing OpsMetrics snapshot (from metrics.ts) into
 * Prometheus exposition format using a dedicated prom-client Registry.
 *
 * Design decisions:
 * - Dedicated Registry — avoids polluting the prom-client global default.
 * - Snapshot gauges — OpsMetrics values are point-in-time; we set them on
 *   each scrape rather than incrementing counters we don't own.
 * - HTTP request counter + histogram are real prom-client primitives
 *   incremented from Express middleware via observeHttpRequest().
 */

import { Registry, Gauge, Counter, Histogram } from "prom-client";
import { getMetrics } from "./metrics.js";

// ── Registry ─────────────────────────────────────────────────────────

const registry = new Registry();

// ── Process gauges ───────────────────────────────────────────────────

const uptimeGauge = new Gauge({
  name: "bridge_uptime_seconds",
  help: "Process uptime in seconds",
  registers: [registry],
});

const memoryGauge = new Gauge({
  name: "bridge_memory_bytes",
  help: "Process memory usage in bytes",
  labelNames: ["type"] as const,
  registers: [registry],
});

const cpuGauge = new Gauge({
  name: "bridge_cpu_percent",
  help: "Process CPU usage percentage",
  registers: [registry],
});

// ── IBKR gauges ──────────────────────────────────────────────────────

const ibkrConnectedGauge = new Gauge({
  name: "ibkr_connected",
  help: "Whether IBKR TWS is connected (1 = yes, 0 = no)",
  registers: [registry],
});

const ibkrUptimeGauge = new Gauge({
  name: "ibkr_uptime_percent",
  help: "IBKR connection uptime percentage",
  registers: [registry],
});

const ibkrDisconnectsGauge = new Gauge({
  name: "ibkr_disconnects_total",
  help: "Total IBKR disconnect count (snapshot)",
  registers: [registry],
});

const ibkrReconnectAttemptsGauge = new Gauge({
  name: "ibkr_reconnect_attempts_total",
  help: "Total IBKR reconnect attempts (snapshot)",
  registers: [registry],
});

// ── Tunnel gauges ────────────────────────────────────────────────────

const tunnelConnectedGauge = new Gauge({
  name: "tunnel_connected",
  help: "Whether the tunnel is connected (1 = yes, 0 = no)",
  registers: [registry],
});

const tunnelUptimeGauge = new Gauge({
  name: "tunnel_uptime_percent",
  help: "Tunnel uptime percentage",
  registers: [registry],
});

const tunnelLatencyGauge = new Gauge({
  name: "tunnel_probe_latency_ms",
  help: "Last tunnel probe latency in milliseconds",
  registers: [registry],
});

// ── MCP gauges ───────────────────────────────────────────────────────

const mcpSessionsTotalGauge = new Gauge({
  name: "mcp_sessions_total",
  help: "Total MCP sessions (lifetime)",
  registers: [registry],
});

const mcpSessionsActiveGauge = new Gauge({
  name: "mcp_sessions_active",
  help: "Currently active MCP sessions",
  registers: [registry],
});

const mcpToolCallsGauge = new Gauge({
  name: "mcp_tool_calls_total",
  help: "Total MCP tool calls (lifetime snapshot)",
  registers: [registry],
});

// ── SLA gauges ───────────────────────────────────────────────────────

const slaEndToEndGauge = new Gauge({
  name: "sla_end_to_end_percent",
  help: "End-to-end SLA percentage",
  labelNames: ["window"] as const,
  registers: [registry],
});

// ── Incidents gauge ──────────────────────────────────────────────────

const incidentsGauge = new Gauge({
  name: "bridge_incidents_total",
  help: "Total recorded incidents (snapshot)",
  registers: [registry],
});

// ── HTTP request primitives (real counter + histogram) ───────────────

const httpRequestsCounter = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["status_code"] as const,
  registers: [registry],
});

const httpDurationHistogram = new Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["status_code"] as const,
  buckets: [10, 50, 100, 250, 500, 1000, 2500],
  registers: [registry],
});

// ── Public API ───────────────────────────────────────────────────────

/**
 * Collect all metrics: update snapshot gauges from getMetrics(), then
 * return the full Prometheus exposition text.
 */
export async function collectMetrics(): Promise<string> {
  const m = getMetrics();

  // Process
  uptimeGauge.set(m.uptimeSeconds);
  memoryGauge.labels("heap_used").set(m.memoryMb.heapUsed * 1024 * 1024);
  memoryGauge.labels("heap_total").set(m.memoryMb.heapTotal * 1024 * 1024);
  memoryGauge.labels("rss").set(m.memoryMb.rss * 1024 * 1024);
  cpuGauge.set(m.cpuPercent);

  // IBKR
  ibkrConnectedGauge.set(m.ibkrConnected ? 1 : 0);
  ibkrUptimeGauge.set(m.ibkrUptimePercent);
  ibkrDisconnectsGauge.set(m.ibkrDisconnects);
  ibkrReconnectAttemptsGauge.set(m.ibkrReconnectAttempts);

  // Tunnel
  tunnelConnectedGauge.set(m.tunnelConnected ? 1 : 0);
  tunnelUptimeGauge.set(m.tunnelUptimePercent);
  tunnelLatencyGauge.set(m.tunnelLastProbeLatencyMs);

  // MCP
  mcpSessionsTotalGauge.set(m.mcpSessions.total);
  mcpSessionsActiveGauge.set(m.mcpSessions.active);
  mcpToolCallsGauge.set(m.mcpSessions.totalToolCalls);

  // SLA (may be absent)
  if (m.sla) {
    slaEndToEndGauge.labels("1h").set(m.sla.last_1h.end_to_end_pct);
    slaEndToEndGauge.labels("24h").set(m.sla.last_24h.end_to_end_pct);
  }

  // Incidents
  incidentsGauge.set(m.incidentCount);

  return registry.metrics();
}

/**
 * Content-Type header value for Prometheus scrape responses.
 */
export function getPrometheusContentType(): string {
  return registry.contentType;
}

/**
 * Record an HTTP request observation (called from Express middleware).
 * Increments the request counter and observes the duration histogram.
 */
export function observeHttpRequest(statusCode: number, durationMs: number): void {
  const code = String(statusCode);
  httpRequestsCounter.labels(code).inc();
  httpDurationHistogram.labels(code).observe(durationMs);
}
