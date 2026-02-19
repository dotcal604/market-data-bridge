/**
 * Cloudflare tunnel health monitor.
 * 
 * Probes https://api.klfh-dot-io.com/health every 5 minutes to verify external connectivity.
 * Tracks tunnel uptime %, latency, and failure incidents.
 * Auto-restart tunnel after 3 consecutive failures.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { recordIncident } from "./metrics.js";
import { logger } from "../logging.js";

const execAsync = promisify(exec);
const log = logger.child({ subsystem: "tunnel-monitor" });

// ── Tunnel State ──────────────────────────────────────────────────────

const TUNNEL_URL = process.env.TUNNEL_URL || "https://api.klfh-dot-io.com/health";
const TUNNEL_TIMEOUT_MS = 10_000; // 10s timeout for health probe
const FAILURE_THRESHOLD = 3; // consecutive failures before restart

let tunnelConnectedMs = 0;
let tunnelDisconnectedMs = 0;
let tunnelLastStateChange = Date.now();
let tunnelLastKnownState = true; // assume up initially
let consecutiveFailures = 0;
let lastProbeLatencyMs = 0;
let lastProbeTimestamp: string | null = null;
let restartAttempts = 0;

interface TunnelProbeResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

// ── Tunnel Health Probe ───────────────────────────────────────────────

async function probeTunnelHealth(): Promise<TunnelProbeResult> {
  const startMs = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TUNNEL_TIMEOUT_MS);

    const response = await fetch(TUNNEL_URL, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const latencyMs = Date.now() - startMs;

    if (response.ok) {
      return { success: true, latencyMs };
    } else {
      return {
        success: false,
        latencyMs,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startMs;
    if (err.name === "AbortError") {
      return {
        success: false,
        latencyMs,
        error: `Timeout after ${TUNNEL_TIMEOUT_MS}ms`,
      };
    }
    return {
      success: false,
      latencyMs,
      error: err.message || String(err),
    };
  }
}

// ── Tunnel Restart ────────────────────────────────────────────────────

async function attemptTunnelRestart(): Promise<boolean> {
  log.warn("Attempting tunnel restart via cloudflared service...");
  restartAttempts++;

  try {
    // Try Windows service restart first
    try {
      const { stdout, stderr } = await execAsync("sc query cloudflared", { timeout: 5000 });
      if (stdout.includes("RUNNING") || stdout.includes("STOPPED")) {
        log.info("Detected Windows service — restarting cloudflared...");
        await execAsync("sc stop cloudflared", { timeout: 10000 }).catch(() => {
          // Service might already be stopped
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await execAsync("sc start cloudflared", { timeout: 10000 });
        log.info("Cloudflared Windows service restart command sent");
        recordIncident("tunnel_restart", "warning", "Cloudflared service restart attempted via sc start");
        return true;
      }
    } catch {
      // Not a Windows service or sc command failed
    }

    // Try systemd service restart (Linux)
    try {
      await execAsync("systemctl restart cloudflared", { timeout: 10000 });
      log.info("Cloudflared systemd service restart command sent");
      recordIncident("tunnel_restart", "warning", "Cloudflared service restart attempted via systemctl");
      return true;
    } catch {
      // Not systemd
    }

    // If we get here, we couldn't restart the service
    log.error("Failed to restart tunnel — no supported service manager found (sc/systemctl)");
    recordIncident("tunnel_restart_failed", "critical", "Unable to restart cloudflared — no supported service manager");
    return false;
  } catch (err: any) {
    log.error({ err }, "Tunnel restart attempt failed");
    recordIncident("tunnel_restart_failed", "critical", `Tunnel restart failed: ${err.message}`);
    return false;
  }
}

// ── State Tracking ────────────────────────────────────────────────────

function updateTunnelAvailability(currentlyConnected: boolean): void {
  const now = Date.now();
  const elapsed = now - tunnelLastStateChange;
  if (tunnelLastKnownState) {
    tunnelConnectedMs += elapsed;
  } else {
    tunnelDisconnectedMs += elapsed;
  }
  tunnelLastKnownState = currentlyConnected;
  tunnelLastStateChange = now;
}

// ── Scheduled Health Check ────────────────────────────────────────────

export async function checkTunnelHealth(): Promise<void> {
  const result = await probeTunnelHealth();
  lastProbeTimestamp = new Date().toISOString();

  if (result.success) {
    // Tunnel is up
    updateTunnelAvailability(true);
    lastProbeLatencyMs = result.latencyMs ?? 0;

    // Reset failure counter on success
    if (consecutiveFailures > 0) {
      log.info(
        { latencyMs: result.latencyMs, prevFailures: consecutiveFailures },
        "Tunnel health check succeeded — failure streak cleared",
      );
      consecutiveFailures = 0;
    }
  } else {
    // Tunnel is down
    updateTunnelAvailability(false);
    consecutiveFailures++;

    log.warn(
      { consecutiveFailures, error: result.error, latencyMs: result.latencyMs },
      `Tunnel health check failed (${consecutiveFailures}/${FAILURE_THRESHOLD})`,
    );

    recordIncident(
      "tunnel_failure",
      consecutiveFailures >= FAILURE_THRESHOLD ? "critical" : "warning",
      `Tunnel health probe failed: ${result.error} (${consecutiveFailures}/${FAILURE_THRESHOLD})`,
    );

    // Attempt restart after threshold
    if (consecutiveFailures >= FAILURE_THRESHOLD) {
      log.error(
        { consecutiveFailures, threshold: FAILURE_THRESHOLD },
        "Tunnel failure threshold reached — attempting restart",
      );
      const restarted = await attemptTunnelRestart();
      if (restarted) {
        // Give tunnel time to come back up
        await new Promise((resolve) => setTimeout(resolve, 5000));
        // Probe again to verify
        const verifyResult = await probeTunnelHealth();
        if (verifyResult.success) {
          log.info({ latencyMs: verifyResult.latencyMs }, "Tunnel restart successful — health restored");
          consecutiveFailures = 0;
          updateTunnelAvailability(true);
        } else {
          log.error({ error: verifyResult.error }, "Tunnel restart failed — health check still failing");
        }
      }
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────

export interface TunnelMetrics {
  tunnelUptimePercent: number;
  tunnelLastProbeLatencyMs: number;
  tunnelConsecutiveFailures: number;
  tunnelRestartAttempts: number;
  tunnelLastProbeTimestamp: string | null;
  tunnelUrl: string;
  tunnelConnected: boolean;
}

export function getTunnelMetrics(): TunnelMetrics {
  // Update one more time before reporting
  updateTunnelAvailability(consecutiveFailures === 0);

  const totalTracked = tunnelConnectedMs + tunnelDisconnectedMs;
  const uptimePct =
    totalTracked > 0
      ? Math.round((tunnelConnectedMs / totalTracked) * 1000) / 10
      : 100; // assume up if no data yet

  return {
    tunnelUptimePercent: uptimePct,
    tunnelLastProbeLatencyMs: lastProbeLatencyMs,
    tunnelConsecutiveFailures: consecutiveFailures,
    tunnelRestartAttempts: restartAttempts,
    tunnelLastProbeTimestamp: lastProbeTimestamp,
    tunnelUrl: TUNNEL_URL,
    tunnelConnected: consecutiveFailures === 0,
  };
}

/** Reset all tunnel state — for testing only */
export function resetTunnelState(): void {
  tunnelConnectedMs = 0;
  tunnelDisconnectedMs = 0;
  tunnelLastStateChange = Date.now();
  tunnelLastKnownState = true;
  consecutiveFailures = 0;
  lastProbeLatencyMs = 0;
  lastProbeTimestamp = null;
  restartAttempts = 0;
}
