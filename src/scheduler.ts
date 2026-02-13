import { isConnected } from "./ibkr/connection.js";
import { getAccountSummary, getPositions } from "./ibkr/account.js";
import { insertAccountSnapshot, insertPositionSnapshot } from "./db/database.js";
import { logger } from "./logging.js";

const log = logger.child({ subsystem: "scheduler" });

let snapshotTimer: ReturnType<typeof setInterval> | null = null;

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

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function startScheduler(intervalMs: number = DEFAULT_INTERVAL_MS) {
  if (snapshotTimer) return;
  log.info({ intervalMs }, "Scheduler started — periodic snapshots enabled");
  snapshotTimer = setInterval(takeSnapshots, intervalMs);
  // Also take one immediately
  takeSnapshots();
}

export function stopScheduler() {
  if (snapshotTimer) {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
    log.info("Scheduler stopped");
  }
}
