import { isConnected } from "./ibkr/connection.js";
import { getAccountSummary, getPositions } from "./ibkr/account.js";
import { flattenAllPositions } from "./ibkr/orders.js";
import { insertAccountSnapshot, insertPositionSnapshot } from "./db/database.js";
import { computeDriftReport, type DriftReport } from "./eval/drift.js";
import { checkDriftAlerts } from "./eval/drift-alerts.js";
import { pruneInbox } from "./inbox/store.js";
import { config } from "./config.js";
import { checkTunnelHealth } from "./ops/tunnel-monitor.js";
import { sampleAvailability, pruneOldSamples, SAMPLE_INTERVAL_MS } from "./ops/availability.js";
import { logger } from "./logging.js";

const log = logger.child({ subsystem: "scheduler" });

let snapshotTimer: ReturnType<typeof setInterval> | null = null;
let flattenTimer: ReturnType<typeof setInterval> | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
let tunnelCheckTimer: ReturnType<typeof setInterval> | null = null;
let availabilityTimer: ReturnType<typeof setInterval> | null = null;
let flattenFiredToday = "";
let lastPruneDate = "";

// Check if we're in a market session worth snapshotting (pre-market through after-hours)
function isMarketActive(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = et.getHours();
  const minute = et.getMinutes();
  const day = et.getDay();
  // Skip weekends
  if (day === 0 || day === 6) return false;
  // Active 4:00 AM – 8:00 PM ET (pre-market through after-hours)
  const timeMinutes = hour * 60 + minute;
  return timeMinutes >= 240 && timeMinutes <= 1200;
}

async function takeSnapshots() {
  if (!isConnected()) return;
  if (!isMarketActive()) {
    log.debug("Skipping snapshot — market closed");
    return;
  }

  try {
    const [summary, positions] = await Promise.all([
      getAccountSummary(),
      getPositions(),
    ]);

    // Get P&L data - wrap in try/catch since it might fail independently
    let pnlData = null;
    try {
      const { getPnL } = await import("./ibkr/account.js");
      pnlData = await getPnL();
    } catch (e: any) {
      log.warn({ err: e }, "Failed to fetch P&L for snapshot");
    }

    insertAccountSnapshot({
      net_liquidation: summary.netLiquidation ?? undefined,
      total_cash_value: summary.totalCashValue ?? undefined,
      buying_power: summary.buyingPower ?? undefined,
      daily_pnl: pnlData?.dailyPnL ?? undefined,
      unrealized_pnl: pnlData?.unrealizedPnL ?? undefined,
      realized_pnl: pnlData?.realizedPnL ?? undefined,
    });

    insertPositionSnapshot(
      positions.map((p) => ({ symbol: p.symbol, position: p.position, avgCost: p.avgCost })),
      "scheduled",
    );

    log.info(
      { netLiq: summary.netLiquidation, positions: positions.length, dailyPnL: pnlData?.dailyPnL },
      "Periodic snapshot recorded",
    );
  } catch (e: any) {
    log.error({ err: e }, "Periodic snapshot failed");
  }
}

// ── Drift Check (scheduled) ──────────────────────────────────────────────

let lastDriftState: { regime_shift_detected: boolean; overall_accuracy: number } | null = null;
let driftTimer: ReturnType<typeof setInterval> | null = null;
const DRIFT_CHECK_MS = 30 * 60 * 1000; // every 30 minutes

function checkDrift() {
  if (!isMarketActive()) return;

  try {
    const report: DriftReport = computeDriftReport();
    const prev = lastDriftState;

    // Check for alerts based on thresholds
    const alerts = checkDriftAlerts(report);

    // Log on first run or state change
    if (!prev) {
      log.info(
        { regime_shift: report.regime_shift_detected, accuracy: report.overall_accuracy, models: report.by_model.length },
        "Drift baseline established",
      );
    } else if (report.regime_shift_detected && !prev.regime_shift_detected) {
      // Regime shift just detected — alert
      const shiftedModels = report.by_model
        .filter((m) => m.regime_shift_detected)
        .map((m) => `${m.model_id} (last_50=${m.rolling_accuracy.last_50}, last_10=${m.rolling_accuracy.last_10})`);

      log.warn(
        {
          regime_shift: true,
          overall_accuracy: report.overall_accuracy,
          shifted_models: shiftedModels,
          recommendation: report.recommendation,
          alerts: alerts.length,
        },
        `DRIFT ALERT: Regime shift detected — ${shiftedModels.length} model(s) degrading`,
      );
    } else if (!report.regime_shift_detected && prev.regime_shift_detected) {
      log.info(
        { regime_shift: false, accuracy: report.overall_accuracy },
        "Drift alert cleared — regime shift resolved",
      );
    } else if (Math.abs(report.overall_accuracy - prev.overall_accuracy) > 0.05) {
      // Accuracy moved more than 5% — worth noting
      const direction = report.overall_accuracy < prev.overall_accuracy ? "degraded" : "improved";
      log.info(
        { prev_accuracy: prev.overall_accuracy, accuracy: report.overall_accuracy, direction },
        `Model accuracy ${direction}: ${prev.overall_accuracy} → ${report.overall_accuracy}`,
      );
    }

    // Log alerts if any were generated
    if (alerts.length > 0) {
      log.warn(
        { alert_count: alerts.length, alerts: alerts.map((a) => ({ type: a.alert_type, model: a.model_id, value: a.metric_value })) },
        `Drift alerts generated: ${alerts.length} threshold(s) breached`,
      );
    }

    lastDriftState = {
      regime_shift_detected: report.regime_shift_detected,
      overall_accuracy: report.overall_accuracy,
    };
  } catch (e: any) {
    log.error({ err: e }, "Drift check failed");
  }
}

export function getLastDriftState() {
  return lastDriftState;
}

// ── EOD Flatten (3:55 PM ET) ─────────────────────────────────────────────

const FLATTEN_HOUR = parseInt(process.env.FLATTEN_HOUR ?? "15", 10);
const FLATTEN_MINUTE = parseInt(process.env.FLATTEN_MINUTE ?? "55", 10);
let flattenEnabled = (process.env.FLATTEN_ENABLED ?? "true") !== "false";

/** Get current ET date as YYYY-MM-DD (correct timezone, not UTC) */
function getTodayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD"
}

/** Get current ET hour + minute */
function getNowET(): { hour: number; minute: number; day: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  return { hour, minute, day };
}

export function setFlattenEnabled(enabled: boolean) {
  flattenEnabled = enabled;
  log.info({ enabled }, `EOD flatten ${enabled ? "enabled" : "disabled"}`);
}

export function getFlattenConfig() {
  return {
    enabled: flattenEnabled,
    time: `${String(FLATTEN_HOUR).padStart(2, "0")}:${String(FLATTEN_MINUTE).padStart(2, "0")} ET`,
    firedToday: flattenFiredToday,
  };
}

async function checkFlatten() {
  if (!flattenEnabled) return;
  if (!isConnected()) return;

  const { hour, minute, day } = getNowET();
  if (day === 0 || day === 6) return; // weekends

  const today = getTodayET();

  // Auto-reset for new trading day (process stays up across days)
  if (flattenFiredToday && flattenFiredToday !== today) {
    log.info({ prev: flattenFiredToday, today }, "New trading day — flatten reset");
    flattenFiredToday = "";
  }

  // Already fired today — don't double-flatten
  if (flattenFiredToday === today) return;

  // Fire at FLATTEN_HOUR:FLATTEN_MINUTE (default 15:55 ET)
  if (hour === FLATTEN_HOUR && minute === FLATTEN_MINUTE) {
    flattenFiredToday = today;
    log.warn(
      { time: `${hour}:${String(minute).padStart(2, "0")} ET` },
      "EOD FLATTEN TRIGGERED — closing all positions",
    );

    try {
      const result = await flattenAllPositions();
      log.warn(
        { flattened: result.flattened.length, skipped: result.skipped.length },
        `EOD flatten complete: ${result.flattened.length} positions closed`,
      );
    } catch (e: any) {
      log.error({ err: e }, "EOD flatten FAILED");
    }
  }
}

// ── Daily Inbox Prune ────────────────────────────────────────────────────

const PRUNE_CHECK_MS = 60 * 60 * 1000; // check every hour

function checkPrune() {
  const today = getTodayET();
  if (lastPruneDate === today) return; // already pruned today

  lastPruneDate = today;
  try {
    const ttlDays = config.inbox.ttlDays;
    const result = pruneInbox(ttlDays);
    if (result.dbPruned > 0 || result.memoryPruned > 0) {
      log.info({ ttlDays, ...result }, "Daily inbox prune complete");
    }
  } catch (e: any) {
    log.error({ err: e }, "Daily inbox prune failed");
  }
}

// ── Scheduler Lifecycle ──────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FLATTEN_CHECK_MS = 30 * 1000;         // check every 30s (tight window)
const TUNNEL_CHECK_MS = 5 * 60 * 1000;      // check tunnel every 5 minutes

export function startScheduler(intervalMs: number = DEFAULT_INTERVAL_MS) {
  if (snapshotTimer) return;
  log.info({ intervalMs }, "Scheduler started — periodic snapshots enabled");
  snapshotTimer = setInterval(() => {
    takeSnapshots().catch((err) => log.error({ err }, "Snapshot timer error (swallowed)"));
  }, intervalMs);
  // Also take one immediately
  takeSnapshots().catch((err) => log.error({ err }, "Initial snapshot error (swallowed)"));

  // Start flatten check (30s interval — must not miss the 1-minute window)
  if (!flattenTimer) {
    flattenTimer = setInterval(() => {
      checkFlatten().catch((err) => log.error({ err }, "Flatten timer error (swallowed)"));
    }, FLATTEN_CHECK_MS);
    log.info(
      { flattenTime: `${FLATTEN_HOUR}:${String(FLATTEN_MINUTE).padStart(2, "0")} ET`, enabled: flattenEnabled },
      "EOD flatten scheduler armed",
    );
  }

  // Start drift monitoring (30-min interval)
  if (!driftTimer) {
    driftTimer = setInterval(() => {
      try { checkDrift(); } catch (err) { log.error({ err }, "Drift timer error (swallowed)"); }
    }, DRIFT_CHECK_MS);
    // Run first check after 60s (let DB settle on startup)
    setTimeout(() => {
      try { checkDrift(); } catch (err) { log.error({ err }, "Initial drift check error (swallowed)"); }
    }, 60_000);
    log.info({ intervalMin: DRIFT_CHECK_MS / 60_000 }, "Drift monitor armed — checking every 30 min during market hours");
  }

  // Start daily inbox prune (hourly check, fires once per day)
  if (!pruneTimer) {
    pruneTimer = setInterval(checkPrune, PRUNE_CHECK_MS);
    // Run first prune check after 30s (let DB settle)
    setTimeout(checkPrune, 30_000);
    log.info({ ttlDays: config.inbox.ttlDays }, "Inbox prune scheduler armed — daily cleanup");
  }

  // Start tunnel health monitoring (5-min interval)
  if (!tunnelCheckTimer) {
    tunnelCheckTimer = setInterval(() => {
      checkTunnelHealth().catch((err) => log.error({ err }, "Tunnel health check error (swallowed)"));
    }, TUNNEL_CHECK_MS);
    // Run first check after 30s (give tunnel time to settle on startup)
    setTimeout(() => {
      checkTunnelHealth().catch((err) => log.error({ err }, "Initial tunnel health check error (swallowed)"));
    }, 30_000);
    log.info({ intervalMin: TUNNEL_CHECK_MS / 60_000 }, "Tunnel health monitor armed — checking every 5 min");
  }

  // Start availability sampling (30s interval — continuous SLA tracking)
  if (!availabilityTimer) {
    availabilityTimer = setInterval(() => {
      sampleAvailability().catch((err) => log.error({ err }, "Availability sampling error (swallowed)"));
    }, SAMPLE_INTERVAL_MS);
    // Take initial sample immediately
    sampleAvailability().catch((err) => log.error({ err }, "Initial availability sample error (swallowed)"));
    log.info({ intervalSec: SAMPLE_INTERVAL_MS / 1000 }, "Availability sampling armed — tracking uptime every 30s");

    // Prune old samples once per hour
    setInterval(() => {
      try { pruneOldSamples(); } catch (err) { log.error({ err }, "Availability prune error (swallowed)"); }
    }, 60 * 60 * 1000); // 1 hour
  }
}

export function stopScheduler() {
  if (snapshotTimer) {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
  }
  if (flattenTimer) {
    clearInterval(flattenTimer);
    flattenTimer = null;
  }
  if (driftTimer) {
    clearInterval(driftTimer);
    driftTimer = null;
  }
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
  if (tunnelCheckTimer) {
    clearInterval(tunnelCheckTimer);
    tunnelCheckTimer = null;
  }
  if (availabilityTimer) {
    clearInterval(availabilityTimer);
    availabilityTimer = null;
  }
  log.info("Scheduler stopped");
}
