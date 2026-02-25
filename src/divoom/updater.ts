/**
 * Divoom Display Updater
 *
 * Rotates through market data screens on the Divoom TimeFrame display.
 * Each screen fetches its own data (indices, movers, sectors, portfolio, etc.)
 * and renders color-coded text lines.
 *
 * Follows the same pattern as holly/watcher.ts: config-gated, polling, logger, shutdown.
 */

import { DivoomDisplay } from "./display.js";
import { getScreens, buildScrollingTicker, type Screen } from "./screens.js";
import { config } from "../config.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "divoom-updater" });

let rotationTimer: ReturnType<typeof setInterval> | null = null;
let display: DivoomDisplay | null = null;
let screens: Screen[] = [];
let currentScreenIndex = 0;

/**
 * Render the current screen on the display
 */
async function renderCurrentScreen(): Promise<void> {
  if (!display || screens.length === 0) return;

  const screen = screens[currentScreenIndex % screens.length];

  try {
    const lines = await screen.fetch();

    // Clear previous text slots, then send new lines
    await display.clearAllTexts(8);
    await display.sendLines(lines);

    log.debug({ screen: screen.name, lineCount: lines.length }, "Screen rendered");
  } catch (err) {
    log.error({ err, screen: screen.name }, "Failed to render screen");
  }
}

/**
 * Advance to next screen and render it
 */
async function rotateScreen(): Promise<void> {
  currentScreenIndex = (currentScreenIndex + 1) % screens.length;
  await renderCurrentScreen();
}

/**
 * Start the Divoom display updater
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

  display = new DivoomDisplay(config.divoom.deviceIp);

  // Test connection
  const connected = await display.testConnection();
  if (!connected) {
    log.error({ deviceIp: config.divoom.deviceIp }, "Failed to connect to Divoom device");
    return;
  }

  log.info({
    deviceIp: config.divoom.deviceIp,
    screenRotationMs: config.divoom.screenRotationMs,
    brightness: config.divoom.brightness,
  }, "Divoom updater starting");

  // Set initial brightness
  try {
    await display.setBrightness(config.divoom.brightness);
  } catch (err) {
    log.warn({ err }, "Failed to set initial brightness");
  }

  // Load screens
  screens = getScreens();
  currentScreenIndex = 0;

  log.info({ screenCount: screens.length, screens: screens.map((s) => s.name) }, "Screens loaded");

  // Render first screen immediately
  await renderCurrentScreen();

  // Rotate screens on interval
  rotationTimer = setInterval(rotateScreen, config.divoom.screenRotationMs);
}

/**
 * Stop the Divoom display updater
 */
export async function stopDivoomUpdater(): Promise<void> {
  if (rotationTimer) {
    clearInterval(rotationTimer);
    rotationTimer = null;
  }

  if (display) {
    try {
      await display.clear();
      log.info("Divoom updater stopped and display cleared");
    } catch (err) {
      log.warn({ err }, "Failed to clear display on shutdown");
    }
    display = null;
  }

  screens = [];
  currentScreenIndex = 0;
}

/**
 * Get the current display instance (for testing/MCP tools)
 */
export function getDivoomDisplay(): DivoomDisplay | null {
  return display;
}

/**
 * Get current screen info (for diagnostics)
 */
export function getCurrentScreenInfo(): { name: string; index: number; total: number } | null {
  if (screens.length === 0) return null;
  const idx = currentScreenIndex % screens.length;
  return { name: screens[idx].name, index: idx, total: screens.length };
}

/**
 * Force advance to next screen (for MCP tool)
 */
export async function nextScreen(): Promise<string> {
  if (!display || screens.length === 0) return "Divoom not active";
  await rotateScreen();
  const info = getCurrentScreenInfo();
  return info ? `Now showing: ${info.name} (${info.index + 1}/${info.total})` : "No screens";
}

/**
 * Force show scrolling ticker (for MCP tool)
 */
export async function showScrollingTicker(): Promise<void> {
  if (!display) return;

  try {
    const ticker = await buildScrollingTicker();
    await display.sendScrollingText(ticker.text, ticker.color);
    log.info("Scrolling ticker displayed");
  } catch (err) {
    log.error({ err }, "Failed to show scrolling ticker");
  }
}
