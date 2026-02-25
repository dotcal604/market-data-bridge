/**
 * Divoom TimesFrame Updater
 *
 * Push-based dashboard: enters custom control mode with a full layout,
 * then re-enters on each refresh cycle to update content AND colors.
 *
 * Since UpdateDisplayItems only changes TextMessage (not FontColor),
 * we re-enter custom mode each cycle so dynamic colors (green/red for
 * price direction) are always current.
 *
 * Session-aware: detects session changes and adjusts content
 * (e.g. movers during regular hours, futures during off-hours).
 */

import { TimesFrameDisplay } from "./display.js";
import { buildElements } from "./layout.js";
import { fetchDashboardData, currentSession } from "./screens.js";
import { isConnected } from "../ibkr/connection.js";
import { config } from "../config.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "divoom-updater" });

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let display: TimesFrameDisplay | null = null;
let lastSession = "";
let lastIbkrConnected = false;

/**
 * Refresh the dashboard: fetch all data, build elements, push to display.
 */
async function refreshDashboard(): Promise<void> {
  if (!display) return;

  try {
    // Detect state changes for logging
    const session = currentSession();
    const ibkr = isConnected();

    if (session !== lastSession || ibkr !== lastIbkrConnected) {
      log.info({
        from: lastSession || "(init)", to: session,
        ibkr: lastIbkrConnected !== ibkr ? `${lastIbkrConnected} → ${ibkr}` : ibkr,
      }, "State changed — refreshing layout");
      lastSession = session;
      lastIbkrConnected = ibkr;
    }

    const data = await fetchDashboardData();
    const elements = buildElements(data);

    // Re-enter custom mode each cycle for dynamic colors
    await display.enterCustomMode(elements, config.divoom.backgroundUrl);

    log.debug({ session, elementCount: elements.length }, "Dashboard refreshed");
  } catch (err) {
    log.error({ err }, "Failed to refresh dashboard");
  }
}

/**
 * Start the Divoom TimesFrame updater.
 */
export async function startDivoomUpdater(): Promise<void> {
  if (!config.divoom.enabled) {
    log.info("Divoom updater disabled (DIVOOM_ENABLED not set to true)");
    return;
  }

  if (!config.divoom.deviceIp) {
    log.warn("Divoom updater disabled (DIVOOM_DEVICE_IP not set)");
    return;
  }

  display = new TimesFrameDisplay(config.divoom.deviceIp, config.divoom.devicePort);

  const connected = await display.testConnection();
  if (!connected) {
    log.error({ deviceIp: config.divoom.deviceIp, port: config.divoom.devicePort },
      "Failed to connect to TimesFrame device");
    return;
  }

  log.info({
    deviceIp: config.divoom.deviceIp,
    port: config.divoom.devicePort,
    refreshIntervalMs: config.divoom.refreshIntervalMs,
    brightness: config.divoom.brightness,
  }, "TimesFrame updater starting");

  // Set initial brightness
  try {
    await display.setBrightness(config.divoom.brightness);
  } catch (err) {
    log.warn({ err }, "Failed to set initial brightness");
  }

  // Initial state
  lastSession = currentSession();
  lastIbkrConnected = isConnected();

  // First render
  await refreshDashboard();

  // Periodic refresh
  refreshTimer = setInterval(refreshDashboard, config.divoom.refreshIntervalMs);
}

/**
 * Stop the Divoom TimesFrame updater.
 */
export async function stopDivoomUpdater(): Promise<void> {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (display) {
    try {
      if (display.isInCustomMode) {
        await display.exitCustomMode();
      }
      log.info("TimesFrame updater stopped");
    } catch (err) {
      log.warn({ err }, "Failed to exit custom mode on shutdown");
    }
    display = null;
  }

  lastSession = "";
  lastIbkrConnected = false;
}

/**
 * Get the current display instance (for MCP tools).
 */
export function getDivoomDisplay(): TimesFrameDisplay | null {
  return display;
}

/**
 * Force an immediate dashboard refresh (for MCP tools).
 */
export async function forceRefresh(): Promise<string> {
  if (!display) return "TimesFrame not active";
  await refreshDashboard();
  return `Dashboard refreshed [${lastSession}]`;
}
