/**
 * Central ops metrics collector.
 *
 * Tracks process health, request latency percentiles, error rates,
 * IBKR availability, and incident history. Designed for ITIL-style
 * availability and capacity management.
 */
import { getConnectionStatus } from "../ibkr/connection.js";
import { logger } from "../logging.js";

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

function updateIbkrAvailability(currentlyConnected: boolean): void {
  const now = Date.now();
  const elapsed = now - ibkrLastStateChange;
  if (ibkrLastKnownState) {
    ibkrConnectedMs += elapsed;
  } else {
    ibkrDisconnectedMs += elapsed;
  }
  ibkrLastKnownState = currentlyConnected;
  ibkrLastStateChange = now;
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

  if (severity === "critical") {
    log.error({ incident }, `INCIDENT: ${type} — ${detail}`);
  } else if (severity === "warning") {
    log.warn({ incident }, `INCIDENT: ${type} — ${detail}`);
  } else {
    log.info({ incident }, `INCIDENT: ${type} — ${detail}`);
  }
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

  // Incidents
  incidentCount: number;
  unhandledRejections: number;
  lastIncident: Incident | null;
}

export function getMetrics(): OpsMetrics {
  const mem = process.memoryUsage();
  const connStatus = getConnectionStatus();

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
