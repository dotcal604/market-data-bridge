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
 *
 * Chart-enabled: renders server-side charts (sparklines, gauges, heatmaps)
 * and embeds them as Image elements that the TimesFrame fetches via URL.
 */

import { TimesFrameDisplay } from "./display.js";
import { buildElements, type ChartUrls, type DashboardData } from "./layout.js";
import { fetchDashboardWithCharts, currentSession } from "./screens.js";
import { renderAllCharts } from "./charts.js";
import { isConnected } from "../ibkr/connection.js";
import { config } from "../config.js";
import { logger } from "../logging.js";

// Widget engine (feature-flagged via DIVOOM_USE_WIDGET_ENGINE)
import { renderLayout, CANVAS_W, PAD_X, CONTENT_W } from "./widgets/index.js";
import type { WidgetContext, EngineResult } from "./widgets/index.js";
import { getLayoutForSession } from "./widgets/layouts.js";
// Side-effect import: registers all widgets in the registry
import "./widgets/header.js";
import "./widgets/indices.js";
import "./widgets/spy-sparkline.js";
import "./widgets/sectors.js";
import "./widgets/movers.js";
import "./widgets/portfolio.js";
import "./widgets/news.js";
import "./widgets/footer.js";
import "./widgets/indicators.js";
import "./widgets/volume-bars.js";

const log = logger.child({ module: "divoom-updater" });

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let display: TimesFrameDisplay | null = null;
let lastSession = "";
let lastIbkrConnected = false;
let lastDashboardData: DashboardData | null = null;
let lastEngineResult: EngineResult | null = null;
let lastRefreshAt: string | null = null;

/** Runtime-tunable background settings (admin panel can change these). */
export interface BgClearSettings {
  brightness: number;              // 1-100 (default 90)
  tint: "neutral" | "blue" | "green";  // default "neutral"
  color: string | null;            // hex override e.g. "#0D0C01" — bypasses brightness+tint
}
const bgClearSettings: BgClearSettings = { brightness: 90, tint: "neutral", color: null };

export function getBgClearSettings(): BgClearSettings {
  return { ...bgClearSettings };
}

export function setBgClearSettings(patch: Partial<BgClearSettings>): BgClearSettings {
  if (patch.brightness !== undefined) {
    bgClearSettings.brightness = Math.max(1, Math.min(100, patch.brightness));
  }
  if (patch.tint !== undefined && ["neutral", "blue", "green"].includes(patch.tint)) {
    bgClearSettings.tint = patch.tint;
  }
  // color: set to hex string to override, or null/"" to clear
  if (patch.color !== undefined) {
    bgClearSettings.color = patch.color && /^#[0-9a-fA-F]{6}$/.test(patch.color)
      ? patch.color : null;
  }
  log.info({ bgClear: bgClearSettings }, "Background settings updated");
  return { ...bgClearSettings };
}

/**
 * Build chart URLs from the base URL config.
 * Returns undefined if chartBaseUrl is not configured.
 */
function buildChartUrls(): ChartUrls | undefined {
  const base = config.divoom.chartBaseUrl;
  if (!base) return undefined;

  // Trim trailing slash
  const baseUrl = base.replace(/\/+$/, "");

  return {
    spySparkline: `${baseUrl}/api/divoom/charts/spy-sparkline`,
    sectorHeatmap: `${baseUrl}/api/divoom/charts/sector-heatmap`,
    pnlCurve: `${baseUrl}/api/divoom/charts/pnl-curve`,
    rsiGauge: `${baseUrl}/api/divoom/charts/rsi-gauge`,
    vixGauge: `${baseUrl}/api/divoom/charts/vix-gauge`,
    volumeBars: `${baseUrl}/api/divoom/charts/volume-bars`,
  };
}

/**
 * Refresh via the legacy monolith path (buildElements from layout.ts).
 */
async function refreshLegacy(): Promise<void> {
  if (!display) return;

  // Fetch data and chart inputs in parallel
  const { dashboard, chartInput } = await fetchDashboardWithCharts();
  lastDashboardData = dashboard;
  lastRefreshAt = new Date().toISOString();

  // Render charts (populates cache for the REST endpoint)
  const chartUrls = buildChartUrls();
  if (chartUrls) {
    try {
      await renderAllCharts(chartInput);
    } catch (err) {
      log.warn({ err }, "Chart rendering failed — continuing with text-only layout");
    }
  }

  const elements = buildElements(dashboard, chartUrls);

  // Re-enter custom mode each cycle for dynamic colors
  await display.enterCustomMode(elements, config.divoom.backgroundUrl);

  log.debug({ elementCount: elements.length, charts: !!chartUrls }, "Legacy refresh done");
}

/**
 * Refresh via the widget engine (renderLayout from widgets/engine.ts).
 */
async function refreshWidgetEngine(): Promise<void> {
  if (!display) return;

  const session = currentSession();
  const layout = getLayoutForSession(session);

  // Chart pre-render skipped — Image elements are non-functional on TimesFrame.
  // When/if firmware adds Image element support, re-enable chart rendering here
  // and set ctx.chartBaseUrl = config.divoom.chartBaseUrl.

  // chartBaseUrl intentionally set to undefined — Image elements are non-functional
  // on TimesFrame (device fetches URLs but never renders content). This forces all
  // dual-mode widgets into Text mode and pure-image widgets to opt out (getHeight → 0).
  const ctx: WidgetContext = {
    session,
    ibkrConnected: isConnected(),
    chartBaseUrl: undefined,
    canvas: { width: CANVAS_W, padX: PAD_X, contentWidth: CONTENT_W },
  };

  const result = await renderLayout(layout, ctx);
  lastEngineResult = result;
  lastRefreshAt = new Date().toISOString();

  if (result.elements.length === 0) {
    log.warn({ layout: layout.name, skipped: result.skipped }, "Widget engine produced no elements");
    return;
  }

  // BackgroudImageAddr controls the background layer behind Text elements.
  // Custom control mode defaults to opaque black — NOT transparent.
  // On the transparent IPS panel, non-black pixels keep LCD cells partially
  // open → translucent glass effect. Runtime-tunable via admin API.
  // When compositing is enabled, this will point to the composite JPEG endpoint.
  const chartBase = config.divoom.chartBaseUrl;
  const { brightness: bgBri, tint: bgTint, color: bgColor } = bgClearSettings;
  const bgParams = bgColor
    ? `color=${encodeURIComponent(bgColor)}&t=${Date.now()}`
    : `brightness=${bgBri}&tint=${bgTint}&t=${Date.now()}`;
  const bgUrl = config.divoom.backgroundUrl
    ? `${config.divoom.backgroundUrl}?t=${Date.now()}`
    : chartBase
      ? `${chartBase}/api/divoom/charts/bg-clear?${bgParams}`
      : "";
  await display.enterCustomMode(result.elements, bgUrl);

  log.debug({
    layout: layout.name,
    counts: `${result.counts.text}T/${result.counts.image}I/${result.counts.netdata}N`,
    rendered: result.rendered.length,
    skipped: result.skipped.length,
    degraded: result.degraded,
  }, "Widget engine refresh done");
}

/**
 * Refresh the dashboard: detect state changes, then delegate to the
 * appropriate rendering path (widget engine or legacy monolith).
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

    if (config.divoom.useWidgetEngine) {
      await refreshWidgetEngine();
    } else {
      await refreshLegacy();
    }
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
    chartBaseUrl: config.divoom.chartBaseUrl || "(charts disabled)",
    engine: config.divoom.useWidgetEngine ? "widget" : "legacy",
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
 * Get the current Divoom updater state for the admin dashboard.
 */
export interface DivoomState {
  enabled: boolean;
  connected: boolean;
  deviceIp: string;
  port: number;
  refreshIntervalMs: number;
  brightness: number;
  lastSession: string;
  lastIbkrConnected: boolean;
  inCustomMode: boolean;
  lastRefreshAt: string | null;
  chartBaseUrl: string;
  preview: DashboardData | null;
  enginePreview: EngineResult | null;
}

export function getDivoomState(): DivoomState {
  return {
    enabled: config.divoom.enabled,
    connected: display !== null,
    deviceIp: config.divoom.deviceIp,
    port: config.divoom.devicePort,
    refreshIntervalMs: config.divoom.refreshIntervalMs,
    brightness: config.divoom.brightness,
    lastSession,
    lastIbkrConnected,
    inCustomMode: display?.isInCustomMode ?? false,
    lastRefreshAt,
    chartBaseUrl: config.divoom.chartBaseUrl,
    preview: lastDashboardData,
    enginePreview: lastEngineResult,
  };
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
