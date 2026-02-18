/**
 * Central ops metrics collector.
 *
 * Tracks process health, request latency percentiles, error rates,
 * IBKR availability, MCP session stats, tunnel availability, and incident history.
 * Designed for ITIL-style availability and capacity management.
 */
import { getConnectionStatus } from "../ibkr/connection.js";
import { getMcpSessionStats } from "../db/database.js";
import { getTunnelMetrics } from "./tunnel-monitor.js";
import { wsBroadcast } from "../ws/server.js";
import { logger } from "../logging.js";
import { dispatchWebhook } from "./webhook.js";

const log = logger.child({ subsystem: "ops" });

// ── Process metrics ──────────────────────────────────────────────────

const processStartedAt = new Date().toISOString();

// CPU tracking: sample every 5s, compute rolling % from user+system μs
let lastCpuUsage = process.cpuUsage();
let lastCpuSample = process.hrtime.bigint();
let cpuPercent = 0;

const CPU_SAMPLE_INTERVAL_MS = 5_000;
const cpuTimer = setInterval(() => {
  const now = process.hrtime.bigint();
  const current = process.cpuUsage(lastCpuUsage);
  const elapsedUs = Number(now - lastCpuSample) / 1_000; // ns → μs
  cpuPercent = elapsedUs > 0
    ? Math.round(((current.user + current.system) / elapsedUs) * 100 * 10) / 10
    : 0;
  lastCpuUsage = process.cpuUsage();
  lastCpuSample = now;
}, CPU_SAMPLE_INTERVAL_MS);
cpuTimer.unref(); // don't prevent process exit

// ── IBKR availability tracking ────────────────────────────────────────

let ibkrConnectedMs = 0;
let ibkrDisconnectedMs = 0;
let ibkrLastStateChange = Date.now();
let ibkrLastKnownState = false;
const ibkrStateTransitions: Array<{ timestamp: number; connected: boolean }> = [
  { timestamp: Date.now(), connected: false },
];

function trimIbkrTransitions(): void {
  const cutoff = Date.now() - ONE_HOUR_MS;
  while (ibkrStateTransitions.length > 1 && ibkrStateTransitions[1].timestamp < cutoff) {
    ibkrStateTransitions.shift();
  }
}

function updateIbkrAvailability(currentlyConnected: boolean): void {
  const now = Date.now();
  const elapsed = now - ibkrLastStateChange;
  if (ibkrLastKnownState) {
    ibkrConnectedMs += elapsed;
  } else {
    ibkrDisconnectedMs += elapsed;
  }
  if (currentlyConnected !== ibkrLastKnownState) {
    ibkrStateTransitions.push({ timestamp: now, connected: currentlyConnected });
    trimIbkrTransitions();
  }
  ibkrLastKnownState = currentlyConnected;
  ibkrLastStateChange = now;
}

function getIbkrUptimePercentLastHour(): number {
  trimIbkrTransitions();
  const now = Date.now();
  const windowStart = now - ONE_HOUR_MS;

  let connectedMs = 0;
  for (let i = 0; i < ibkrStateTransitions.length; i++) {
    const current = ibkrStateTransitions[i];
    const next = ibkrStateTransitions[i + 1];
    const segmentStart = Math.max(current.timestamp, windowStart);
    const segmentEnd = next ? next.timestamp : now;
    if (segmentEnd <= windowStart) continue;
    if (current.connected) {
      connectedMs += Math.max(0, segmentEnd - segmentStart);
    }
  }

  return Math.round((connectedMs / ONE_HOUR_MS) * 1000) / 10;
}

// Poll IBKR state every 10s for availability SLA
const ibkrPollTimer = setInterval(() => {
  const { connected } = getConnectionStatus();
  updateIbkrAvailability(connected);
}, 10_000);
ibkrPollTimer.unref();

// ── Request metrics (sliding window) ────────────────────────────────

interface RequestRecord {
  timestamp: number;
  statusCode: number;
  durationMs: number;
  path: string;
}

const WINDOW_MS = 5 * 60 * 1000; // 5-minute sliding window
const MAX_RECORDS = 10_000;
const requestRecords: RequestRecord[] = [];
let totalRequestCount = 0;
let totalErrorCount = 0;

export function recordRequest(path: string, statusCode: number, durationMs: number): void {
  totalRequestCount++;
  if (statusCode >= 500) totalErrorCount++;

  requestRecords.push({ timestamp: Date.now(), statusCode, durationMs, path });
  // Trim old records
  if (requestRecords.length > MAX_RECORDS) {
    requestRecords.splice(0, requestRecords.length - MAX_RECORDS);
  }
}

function getWindowedRecords(): RequestRecord[] {
  const cutoff = Date.now() - WINDOW_MS;
  return requestRecords.filter((r) => r.timestamp >= cutoff);
}

function computePercentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Incident tracking ────────────────────────────────────────────────

export interface Incident {
  type: string;
  severity: "info" | "warning" | "critical";
  timestamp: string;
  detail: string;
}

const MAX_INCIDENTS = 100;
const incidents: Incident[] = [];
let unhandledRejectionCount = 0;

interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const reconnectStarts: number[] = [];
const reconnectDurations: TimeSeriesPoint[] = [];
const heartbeatLatencies: TimeSeriesPoint[] = [];

function trimOneHour(points: TimeSeriesPoint[]): void {
  const cutoff = Date.now() - ONE_HOUR_MS;
  while (points.length > 0 && points[0].timestamp < cutoff) {
    points.shift();
  }
}

function trimOneHourNumbers(points: number[]): void {
  const cutoff = Date.now() - ONE_HOUR_MS;
  while (points.length > 0 && points[0] < cutoff) {
    points.shift();
  }
}

export function recordReconnectStart(): void {
  reconnectStarts.push(Date.now());
  trimOneHourNumbers(reconnectStarts);
}

export function recordReconnectDuration(durationMs: number): void {
  reconnectDurations.push({ timestamp: Date.now(), value: Math.max(0, durationMs) });
  trimOneHour(reconnectDurations);
}

export function recordHeartbeatLatency(latencyMs: number): void {
  heartbeatLatencies.push({ timestamp: Date.now(), value: Math.max(0, latencyMs) });
  trimOneHour(heartbeatLatencies);
}

export function recordIncident(type: string, severity: Incident["severity"], detail: string): void {
  const incident: Incident = {
    type,
    severity,
    timestamp: new Date().toISOString(),
    detail,
  };
  incidents.push(incident);
  if (incidents.length > MAX_INCIDENTS) {
    incidents.splice(0, incidents.length - MAX_INCIDENTS);
  }

  // Broadcast incident to WebSocket clients
  wsBroadcast("incidents", incident);

  if (severity === "critical") {
    log.error({ incident }, `INCIDENT: ${type} — ${detail}`);
  } else if (severity === "warning") {
    log.warn({ incident }, `INCIDENT: ${type} — ${detail}`);
  } else {
    log.info({ incident }, `INCIDENT: ${type} — ${detail}`);
  }

  // Fire-and-forget webhook notification (dedup handled inside)
  dispatchWebhook(incident);
}

export function getRecentIncidents(limit: number = 20): Incident[] {
  return incidents.slice(-limit);
}

export function getLastIncident(): Incident | null {
  return incidents.length > 0 ? incidents[incidents.length - 1] : null;
}

export function incrementUnhandledRejections(): void {
  unhandledRejectionCount++;
}

export interface ConnectionHealth {
  score: number;
  uptimePercentLastHour: number;
  heartbeatP95Ms: number;
  reconnectCountLastHour: number;
}

export function getConnectionHealth(): ConnectionHealth {
  trimOneHour(heartbeatLatencies);
  trimOneHourNumbers(reconnectStarts);

  const uptimePercentLastHour = getIbkrUptimePercentLastHour();
  const heartbeatValues = heartbeatLatencies.map((entry) => entry.value);
  const heartbeatP95Ms = computePercentile(heartbeatValues, 95);
  const reconnectCountLastHour = reconnectStarts.length;

  const uptimeSubScore = uptimePercentLastHour;
  const heartbeatSubScore = heartbeatP95Ms <= 100
    ? 100
    : heartbeatP95Ms >= 2_000
      ? 0
      : Math.round(((2_000 - heartbeatP95Ms) / 1_900) * 100);
  const reconnectSubScore = reconnectCountLastHour === 0
    ? 100
    : reconnectCountLastHour >= 10
      ? 0
      : Math.round(((10 - reconnectCountLastHour) / 10) * 100);

  const weighted = (uptimeSubScore * 0.5) + (heartbeatSubScore * 0.25) + (reconnectSubScore * 0.25);

  return {
    score: Math.max(0, Math.min(100, Math.round(weighted))),
    uptimePercentLastHour,
    heartbeatP95Ms,
    reconnectCountLastHour,
  };
}

export const __test = {
  resetConnectionHealthData(): void {
    reconnectStarts.length = 0;
    reconnectDurations.length = 0;
    heartbeatLatencies.length = 0;
    ibkrConnectedMs = 0;
    ibkrDisconnectedMs = 0;
    ibkrLastStateChange = Date.now();
    ibkrLastKnownState = false;
    ibkrStateTransitions.length = 0;
    ibkrStateTransitions.push({ timestamp: Date.now(), connected: false });
  },
  updateIbkrAvailability,
};

// ── Public API ────────────────────────────────────────────────────────

export interface OpsMetrics {
  // Process
  startedAt: string;
  uptimeSeconds: number;
  memoryMb: { heapUsed: number; heapTotal: number; rss: number };
  cpuPercent: number;

  // IBKR availability
  ibkrUptimePercent: number;
  ibkrDisconnects: number;
  ibkrReconnectAttempts: number;
  ibkrCurrentStreakSeconds: number | null;
  ibkrConnected: boolean;

  // Tunnel availability
  tunnelUptimePercent: number;
  tunnelLastProbeLatencyMs: number;
  tunnelConsecutiveFailures: number;
  tunnelRestartAttempts: number;
  tunnelLastProbeTimestamp: string | null;
  tunnelUrl: string;
  tunnelConnected: boolean;

  // Request metrics (5-min window)
  requests: {
    total: number;
    windowCount: number;
    windowErrors: number;
    errorRate: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
  };

  // MCP session metrics
  mcpSessions: {
    total: number;
    active: number;
    avgDurationSeconds: number | null;
    totalToolCalls: number;
  };

  // Incidents
  incidentCount: number;
  unhandledRejections: number;
  lastIncident: Incident | null;
}

export function getMetrics(): OpsMetrics {
  const mem = process.memoryUsage();
  const connStatus = getConnectionStatus();
  const tunnelMetrics = getTunnelMetrics();

  // Update availability one more time before reporting
  updateIbkrAvailability(connStatus.connected);
  const totalTracked = ibkrConnectedMs + ibkrDisconnectedMs;
  const uptimePct = totalTracked > 0
    ? Math.round((ibkrConnectedMs / totalTracked) * 1000) / 10
    : 0;

  // Windowed request stats
  const windowed = getWindowedRecords();
  const windowErrors = windowed.filter((r) => r.statusCode >= 500).length;
  const durations = windowed.map((r) => r.durationMs);
  const avgLatency = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  // MCP session stats
  const mcpStats = getMcpSessionStats();

  return {
    startedAt: processStartedAt,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMb: {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
      rss: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
    },
    cpuPercent,

    ibkrUptimePercent: uptimePct,
    ibkrDisconnects: connStatus.totalDisconnects,
    ibkrReconnectAttempts: connStatus.reconnectAttempts,
    ibkrCurrentStreakSeconds: connStatus.uptimeSinceConnect,
    ibkrConnected: connStatus.connected,

    tunnelUptimePercent: tunnelMetrics.tunnelUptimePercent,
    tunnelLastProbeLatencyMs: tunnelMetrics.tunnelLastProbeLatencyMs,
    tunnelConsecutiveFailures: tunnelMetrics.tunnelConsecutiveFailures,
    tunnelRestartAttempts: tunnelMetrics.tunnelRestartAttempts,
    tunnelLastProbeTimestamp: tunnelMetrics.tunnelLastProbeTimestamp,
    tunnelUrl: tunnelMetrics.tunnelUrl,
    tunnelConnected: tunnelMetrics.tunnelConnected,

    requests: {
      total: totalRequestCount,
      windowCount: windowed.length,
      windowErrors,
      errorRate: windowed.length > 0
        ? Math.round((windowErrors / windowed.length) * 1000) / 10
        : 0,
      avgLatencyMs: avgLatency,
      p50LatencyMs: computePercentile(durations, 50),
      p95LatencyMs: computePercentile(durations, 95),
      p99LatencyMs: computePercentile(durations, 99),
    },

    mcpSessions: {
      total: mcpStats.total,
      active: mcpStats.active,
      avgDurationSeconds: mcpStats.avg_duration_seconds,
      totalToolCalls: mcpStats.total_tool_calls,
    },

    incidentCount: incidents.length,
    unhandledRejections: unhandledRejectionCount,
    lastIncident: getLastIncident(),
  };
}

// ── Cleanup ──────────────────────────────────────────────────────────

export function stopMetrics(): void {
  clearInterval(cpuTimer);
  clearInterval(ibkrPollTimer);
}
