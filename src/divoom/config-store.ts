/**
 * Divoom Config Store — Centralized Runtime Configuration
 *
 * Three-tier parameterization with debounced JSON file persistence.
 *
 * Tier 1 — CompositeSettings: split point, JPEG quality, cache TTL,
 *          per-section enable/height, color palette.
 * Tier 2 — ContentSettings:   sparkline ticker/timeframe/bars, accent colors.
 * Tier 3 — LayoutSettings:    per-session widget order, per-widget overrides.
 *
 * On startup: loadConfig() reads from data/divoom-config.json (or defaults).
 * On change:  debounced saveConfig() persists to disk after 1s.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { logger } from "../logging.js";

const log = logger.child({ module: "divoom-config" });

// ─── Tier 1: Composite Renderer Settings ──────────────────

export interface SectionConfig {
  enabled: boolean;
  height: number;
}

export interface CompositeSettings {
  /** Y pixel where text zone ends and chart zone begins (400–1000, default 740) */
  splitY: number;
  /** JPEG output quality (50–100, default 85) */
  jpegQuality: number;
  /** Composite render cache TTL in milliseconds (default 20000) */
  cacheTtlMs: number;
  /** Per-section toggle + height */
  sections: {
    sparkline: SectionConfig;
    heatmap: SectionConfig;
    volume: SectionConfig;
    gauges: SectionConfig;
  };
  /** Color palette — 9 named colors used by the composite renderer */
  palette: {
    green: string;
    red: string;
    cyan: string;
    yellow: string;
    orange: string;
    magenta: string;
    white: string;
    dimGray: string;
    muted: string;
  };
}

const DEFAULT_COMPOSITE: CompositeSettings = {
  splitY: 740,
  jpegQuality: 85,
  cacheTtlMs: 20_000,
  sections: {
    sparkline: { enabled: true, height: 200 },
    heatmap: { enabled: true, height: 220 },
    volume: { enabled: true, height: 120 },
    gauges: { enabled: true, height: 40 },
  },
  palette: {
    green: "#00CC44",
    red: "#CC2200",
    cyan: "#00BBDD",
    yellow: "#CCAA00",
    orange: "#DD6600",
    magenta: "#BB00BB",
    white: "#E0E0E0",
    dimGray: "#404044",
    muted: "#606068",
  },
};

// ─── Tier 2: Content / Data Feed Settings ─────────────────

export interface ContentSettings {
  /** Sparkline ticker symbol (default "SPY") */
  sparklineTicker: string;
  /** Sparkline timeframe: "1d" | "5d" | "1mo" | "3mo" (default "1mo") */
  sparklineTimeframe: string;
  /** Number of data points for sparkline (default 22) */
  sparklineBars: number;
  /** Accent color for positive price movement */
  accentUp: string;
  /** Accent color for negative price movement */
  accentDown: string;
  /** Accent color for neutral/flat */
  accentNeutral: string;
  /**
   * Device FontID for text elements (default 52).
   * FontID 52 = clean sans-serif. Other IDs untested — experiment from the dashboard.
   * FontID 52 supports Unicode block elements (▁▂▃▄▅▆▇█) but NOT braille (U+2800–28FF).
   * Use probe-fonts.ts to test other FontIDs.
   */
  fontId: number;
}

const DEFAULT_CONTENT: ContentSettings = {
  sparklineTicker: "SPY",
  sparklineTimeframe: "1mo",
  sparklineBars: 22,
  accentUp: "#00CC44",
  accentDown: "#CC2200",
  accentNeutral: "#00BBDD",
  fontId: 52,
};

// ─── Tier 3: Layout / Widget Settings ─────────────────────

export interface WidgetOverride {
  enabled?: boolean;
  minHeight?: number;
}

export interface LayoutSettings {
  /** Per-session widget order override — session name → widget ID array */
  widgetOrder: Record<string, string[]>;
  /** Per-widget overrides — widget ID → enabled/minHeight */
  widgetOverrides: Record<string, WidgetOverride>;
}

const DEFAULT_LAYOUT: LayoutSettings = {
  widgetOrder: {},
  widgetOverrides: {},
};

// ─── Combined Store ───────────────────────────────────────

interface ConfigStore {
  composite: CompositeSettings;
  content: ContentSettings;
  layout: LayoutSettings;
}

const CONFIG_FILE = path.join(process.cwd(), "data", "divoom-config.json");

let store: ConfigStore = {
  composite: structuredClone(DEFAULT_COMPOSITE),
  content: structuredClone(DEFAULT_CONTENT),
  layout: structuredClone(DEFAULT_LAYOUT),
};

// ─── Deep Merge Helper ────────────────────────────────────

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const srcVal = source[key];
    if (srcVal === undefined) continue;
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      result[key] = srcVal as T[keyof T];
    }
  }
  return result;
}

// ─── Persistence ──────────────────────────────────────────

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      const dir = path.dirname(CONFIG_FILE);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      await writeFile(CONFIG_FILE, JSON.stringify(store, null, 2), "utf-8");
      log.debug("Config persisted to disk");
    } catch (err) {
      log.error({ err }, "Failed to persist config");
    }
  }, 1_000);
}

// ─── Public API ───────────────────────────────────────────

/** Load config from disk (or use defaults). Call once on startup. */
export async function loadConfig(): Promise<void> {
  try {
    if (existsSync(CONFIG_FILE)) {
      const raw = await readFile(CONFIG_FILE, "utf-8");
      const saved = JSON.parse(raw) as Partial<ConfigStore>;
      // Deep merge saved values over defaults so new fields get default values
      if (saved.composite) {
        store.composite = deepMerge(structuredClone(DEFAULT_COMPOSITE), saved.composite);
      }
      if (saved.content) {
        store.content = deepMerge(structuredClone(DEFAULT_CONTENT), saved.content);
      }
      if (saved.layout) {
        store.layout = deepMerge(structuredClone(DEFAULT_LAYOUT), saved.layout);
      }
      log.info("Config loaded from disk");
    } else {
      log.info("No config file found — using defaults");
    }
  } catch (err) {
    log.warn({ err }, "Failed to load config — using defaults");
  }
}

// ── Tier 1: Composite ──

export function getCompositeSettings(): CompositeSettings {
  return structuredClone(store.composite);
}

export function setCompositeSettings(patch: Partial<CompositeSettings>): CompositeSettings {
  store.composite = deepMerge(store.composite, patch);
  // Clamp values
  store.composite.splitY = Math.max(400, Math.min(1000, store.composite.splitY));
  store.composite.jpegQuality = Math.max(50, Math.min(100, store.composite.jpegQuality));
  store.composite.cacheTtlMs = Math.max(1000, Math.min(120_000, store.composite.cacheTtlMs));
  log.info({ composite: store.composite }, "Composite settings updated");
  scheduleSave();
  return structuredClone(store.composite);
}

// ── Tier 2: Content ──

export function getContentSettings(): ContentSettings {
  return structuredClone(store.content);
}

export function setContentSettings(patch: Partial<ContentSettings>): ContentSettings {
  store.content = deepMerge(store.content, patch);
  store.content.sparklineBars = Math.max(5, Math.min(200, store.content.sparklineBars));
  store.content.fontId = Math.max(0, Math.min(255, Math.round(store.content.fontId)));
  log.info({ content: store.content }, "Content settings updated");
  scheduleSave();
  return structuredClone(store.content);
}

// ── Tier 3: Layout ──

export function getLayoutSettings(): LayoutSettings {
  return structuredClone(store.layout);
}

export function setLayoutSettings(patch: Partial<LayoutSettings>): LayoutSettings {
  store.layout = deepMerge(store.layout, patch);
  log.info({ layout: store.layout }, "Layout settings updated");
  scheduleSave();
  return structuredClone(store.layout);
}

// ── Reset ──

export function resetConfig(): void {
  store = {
    composite: structuredClone(DEFAULT_COMPOSITE),
    content: structuredClone(DEFAULT_CONTENT),
    layout: structuredClone(DEFAULT_LAYOUT),
  };
  log.info("Config reset to defaults");
  scheduleSave();
}

// ── Defaults export (for frontend display) ──

export function getDefaults(): ConfigStore {
  return {
    composite: structuredClone(DEFAULT_COMPOSITE),
    content: structuredClone(DEFAULT_CONTENT),
    layout: structuredClone(DEFAULT_LAYOUT),
  };
}
