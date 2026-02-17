/**
 * Availability SLA tracking system.
 *
 * Samples bridge health every 30 seconds, stores in SQLite with 90-day retention,
 * computes SLA percentages for 1h/24h/7d/30d windows, and detects outages.
 */
import { getDb } from "../db/database.js";
import { isConnected } from "../ibkr/connection.js";
import { isReady } from "./readiness.js";
import { logger } from "../logging.js";

const log = logger.child({ subsystem: "ops-availability" });

// Sample interval: 30 seconds
export const SAMPLE_INTERVAL_MS = 30 * 1000;

// Retention: 90 days
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Tunnel health check: try to reach the REST endpoint via localhost
// (In a Cloudflare tunnel setup, this verifies local connectivity)
async function checkTunnelHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout
    
    const response = await fetch("http://localhost:3000/health/ready", {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok; // 200-299 status
  } catch {
    return false;
  }
}

/**
 * Sample current availability state and store in database.
 */
export async function sampleAvailability(): Promise<void> {
  const db = getDb();
  const timestamp = new Date().toISOString();
  
  // Check health signals
  const bridge_ok = isReady();
  const ibkr_ok = isConnected();
  const tunnel_ok = await checkTunnelHealth();
  
  // Count active MCP sessions (would need to be passed in from server.ts if needed)
  // For now, we'll omit this or default to 0
  const mcp_sessions = 0;
  
  const stmt = db.prepare(`
    INSERT INTO ops_availability (timestamp, bridge_ok, ibkr_ok, tunnel_ok, mcp_sessions)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(timestamp, bridge_ok ? 1 : 0, ibkr_ok ? 1 : 0, tunnel_ok ? 1 : 0, mcp_sessions);
  
  // Log state changes or issues
  if (!bridge_ok || !ibkr_ok || !tunnel_ok) {
    log.warn(
      { bridge_ok, ibkr_ok, tunnel_ok, timestamp },
      "Availability sample: degraded state detected"
    );
  }
}

/**
 * Prune samples older than RETENTION_DAYS.
 */
export function pruneOldSamples(): void {
  const db = getDb();
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  
  const result = db.prepare(`
    DELETE FROM ops_availability WHERE timestamp < ?
  `).run(cutoff);
  
  if (result.changes > 0) {
    log.info({ pruned: result.changes, cutoff }, "Pruned old availability samples");
  }
}

/**
 * Compute availability percentage for a given time window.
 */
function computeAvailability(windowMs: number): {
  bridge_pct: number;
  ibkr_pct: number;
  tunnel_pct: number;
  end_to_end_pct: number;
  sample_count: number;
} {
  const db = getDb();
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  
  const result = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(bridge_ok) as bridge_up,
      SUM(ibkr_ok) as ibkr_up,
      SUM(tunnel_ok) as tunnel_up,
      SUM(CASE WHEN bridge_ok AND ibkr_ok AND tunnel_ok THEN 1 ELSE 0 END) as end_to_end_up
    FROM ops_availability
    WHERE timestamp >= ?
  `).get(cutoff) as {
    total: number;
    bridge_up: number;
    ibkr_up: number;
    tunnel_up: number;
    end_to_end_up: number;
  };
  
  const total = result.total || 0;
  
  if (total === 0) {
    return {
      bridge_pct: 0,
      ibkr_pct: 0,
      tunnel_pct: 0,
      end_to_end_pct: 0,
      sample_count: 0,
    };
  }
  
  return {
    bridge_pct: Math.round((result.bridge_up / total) * 1000) / 10,
    ibkr_pct: Math.round((result.ibkr_up / total) * 1000) / 10,
    tunnel_pct: Math.round((result.tunnel_up / total) * 1000) / 10,
    end_to_end_pct: Math.round((result.end_to_end_up / total) * 1000) / 10,
    sample_count: total,
  };
}

/**
 * Get SLA report for all time windows.
 */
export interface SlaReport {
  last_1h: {
    bridge_pct: number;
    ibkr_pct: number;
    tunnel_pct: number;
    end_to_end_pct: number;
    sample_count: number;
  };
  last_24h: {
    bridge_pct: number;
    ibkr_pct: number;
    tunnel_pct: number;
    end_to_end_pct: number;
    sample_count: number;
  };
  last_7d: {
    bridge_pct: number;
    ibkr_pct: number;
    tunnel_pct: number;
    end_to_end_pct: number;
    sample_count: number;
  };
  last_30d: {
    bridge_pct: number;
    ibkr_pct: number;
    tunnel_pct: number;
    end_to_end_pct: number;
    sample_count: number;
  };
  current_status: {
    bridge_ok: boolean;
    ibkr_ok: boolean;
    tunnel_ok: boolean;
    end_to_end_ok: boolean;
    timestamp: string;
  };
}

export function getSlaReport(): SlaReport {
  const db = getDb();
  
  // Get current status (most recent sample)
  const latest = db.prepare(`
    SELECT timestamp, bridge_ok, ibkr_ok, tunnel_ok
    FROM ops_availability
    ORDER BY timestamp DESC
    LIMIT 1
  `).get() as { timestamp: string; bridge_ok: number; ibkr_ok: number; tunnel_ok: number } | undefined;
  
  const current_status = latest
    ? {
        bridge_ok: latest.bridge_ok === 1,
        ibkr_ok: latest.ibkr_ok === 1,
        tunnel_ok: latest.tunnel_ok === 1,
        end_to_end_ok: latest.bridge_ok === 1 && latest.ibkr_ok === 1 && latest.tunnel_ok === 1,
        timestamp: latest.timestamp,
      }
    : {
        bridge_ok: false,
        ibkr_ok: false,
        tunnel_ok: false,
        end_to_end_ok: false,
        timestamp: new Date().toISOString(),
      };
  
  return {
    last_1h: computeAvailability(60 * 60 * 1000),
    last_24h: computeAvailability(24 * 60 * 60 * 1000),
    last_7d: computeAvailability(7 * 24 * 60 * 60 * 1000),
    last_30d: computeAvailability(30 * 24 * 60 * 60 * 1000),
    current_status,
  };
}

/**
 * Detect outages from availability samples.
 * An outage is a continuous period where end-to-end availability is 0.
 */
interface OutageDetection {
  start: string;
  end: string | null;
  duration_seconds: number | null;
  affected_components: string;
}

export function detectOutages(sinceTimestamp?: string): OutageDetection[] {
  const db = getDb();
  const cutoff = sinceTimestamp || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  const samples = db.prepare(`
    SELECT timestamp, bridge_ok, ibkr_ok, tunnel_ok
    FROM ops_availability
    WHERE timestamp >= ?
    ORDER BY timestamp ASC
  `).all(cutoff) as Array<{
    timestamp: string;
    bridge_ok: number;
    ibkr_ok: number;
    tunnel_ok: number;
  }>;
  
  const outages: OutageDetection[] = [];
  let currentOutage: OutageDetection | null = null;
  
  for (const sample of samples) {
    const end_to_end_ok = sample.bridge_ok && sample.ibkr_ok && sample.tunnel_ok;
    
    if (!end_to_end_ok) {
      // Outage in progress
      if (!currentOutage) {
        // Start new outage
        const components = [];
        if (!sample.bridge_ok) components.push("bridge");
        if (!sample.ibkr_ok) components.push("ibkr");
        if (!sample.tunnel_ok) components.push("tunnel");
        
        currentOutage = {
          start: sample.timestamp,
          end: null,
          duration_seconds: null,
          affected_components: components.join(","),
        };
      }
    } else {
      // System healthy
      if (currentOutage) {
        // End current outage
        currentOutage.end = sample.timestamp;
        const startMs = new Date(currentOutage.start).getTime();
        const endMs = new Date(sample.timestamp).getTime();
        currentOutage.duration_seconds = Math.round((endMs - startMs) / 1000);
        
        // Only record outages >= 60s (ignore brief transients)
        if (currentOutage.duration_seconds >= 60) {
          outages.push(currentOutage);
        }
        currentOutage = null;
      }
    }
  }
  
  // If there's an ongoing outage at the end
  if (currentOutage) {
    currentOutage.end = new Date().toISOString();
    const startMs = new Date(currentOutage.start).getTime();
    const endMs = new Date(currentOutage.end).getTime();
    currentOutage.duration_seconds = Math.round((endMs - startMs) / 1000);
    
    if (currentOutage.duration_seconds >= 60) {
      outages.push(currentOutage);
    }
  }
  
  return outages;
}

/**
 * Record an outage in the ops_outages table.
 */
export function recordOutage(
  start: string,
  end: string,
  duration_seconds: number,
  affected_components: string,
  cause?: string
): void {
  const db = getDb();
  
  const stmt = db.prepare(`
    INSERT INTO ops_outages (start, end, duration_seconds, affected_components, cause)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(start, end, duration_seconds, affected_components, cause || null);
  
  log.warn(
    { start, end, duration_seconds, affected_components, cause },
    "Outage recorded"
  );
}

/**
 * Get recent outages from the ops_outages table.
 */
export interface Outage {
  id: number;
  start: string;
  end: string;
  duration_seconds: number;
  affected_components: string;
  cause: string | null;
  created_at: string;
}

export function getRecentOutages(limit: number = 20): Outage[] {
  const db = getDb();
  
  const stmt = db.prepare(`
    SELECT id, start, end, duration_seconds, affected_components, cause, created_at
    FROM ops_outages
    ORDER BY start DESC
    LIMIT ?
  `);
  
  return stmt.all(limit) as Outage[];
}
