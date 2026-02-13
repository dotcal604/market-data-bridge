import { isConnected } from "./ibkr/connection.js";
import { getAccountSummary, getPositions } from "./ibkr/account.js";
import { flattenAllPositions } from "./ibkr/orders.js";
import { insertAccountSnapshot, insertPositionSnapshot } from "./db/database.js";
import { logger } from "./logging.js";

const log = logger.child({ subsystem: "scheduler" });

let snapshotTimer: ReturnType<typeof setInterval> | null = null;
let flattenTimer: ReturnType<typeof setInterval> | null = null;
let flattenFiredToday = "";

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

    insertAccountSnapshot({
      net_liquidation: summary.netLiquidation ?? undefined,
      total_cash_value: summary.totalCashValue ?? undefined,
      buying_power: summary.buyingPower ?? undefined,
    });

    insertPositionSnapshot(
      positions.map((p) => ({ symbol: p.symbol, position: p.position, avgCost: p.avgCost })),
      "scheduled",
    );

    log.info(
      { netLiq: summary.netLiquidation, positions: positions.length },
      "Periodic snapshot recorded",
    );
  } catch (e: any) {
    log.error({ err: e }, "Periodic snapshot failed");
  }
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

// ── Scheduler Lifecycle ──────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FLATTEN_CHECK_MS = 30 * 1000;         // check every 30s (tight window)

export function startScheduler(intervalMs: number = DEFAULT_INTERVAL_MS) {
  if (snapshotTimer) return;
  log.info({ intervalMs }, "Scheduler started — periodic snapshots enabled");
  snapshotTimer = setInterval(takeSnapshots, intervalMs);
  // Also take one immediately
  takeSnapshots();

  // Start flatten check (30s interval — must not miss the 1-minute window)
  if (!flattenTimer) {
    flattenTimer = setInterval(checkFlatten, FLATTEN_CHECK_MS);
    log.info(
      { flattenTime: `${FLATTEN_HOUR}:${String(FLATTEN_MINUTE).padStart(2, "0")} ET`, enabled: flattenEnabled },
      "EOD flatten scheduler armed",
    );
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
  log.info("Scheduler stopped");
}
