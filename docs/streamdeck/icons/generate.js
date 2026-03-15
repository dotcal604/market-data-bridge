#!/usr/bin/env node
/**
 * MDB StreamDeck Icon Generator
 *
 * Generates branded SVG icons for every StreamDeck button following
 * the market-data-bridge brand identity system ("The Bridge Grid").
 *
 * Usage:  node docs/streamdeck/icons/generate.js
 * Output: docs/streamdeck/icons/svg/*.svg
 *
 * Design spec:
 *   - 144×144 canvas (2× for MK2's 72×72 native, also works for SD+ 120×120)
 *   - Background: slate-800 (#1e293b) rounded rect
 *   - Top accent bar: 4px strip in category color
 *   - Icon glyph: monochrome slate-200 (#e2e8f0), stroke-based
 *   - No embedded text (titles are set in the Stream Deck app)
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "svg");

// ── Brand palette ──────────────────────────────────────────────
const C = {
  bg:       "#1e293b", // slate-800 (button surface)
  glyph:    "#e2e8f0", // slate-200 (icon stroke)
  emerald:  "#10b981", // primary accent
  purple:   "#8b5cf6", // eval engine
  amber:    "#f59e0b", // warnings, API, screeners
  red:      "#ef4444", // danger, cancel, flatten
  slate:    "#64748b", // market data, utility
  muted:    "#94a3b8", // slate-400, bridge outlines
};

// ── Category → accent color mapping ────────────────────────────
const CAT = {
  connection: C.emerald,
  market:     C.slate,
  eval:       C.purple,
  orders:     C.red,
  portfolio:  C.amber,
  utility:    C.slate,
  nav:        C.muted,
};

// ── Icon definitions ───────────────────────────────────────────
// Each icon: { cat, draw } where draw is SVG inner content
// All coordinates assume 144×144 viewBox, icon area ~36-108 (center 72×72 region)

const icons = {
  // ── Connection / Status (emerald) ──
  "status": {
    cat: "connection",
    draw: `<polyline points="32,72 52,72 62,48 72,96 82,36 92,84 102,60 112,60" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "session": {
    cat: "connection",
    draw: `<path d="M72,38 L98,54 L98,86 L72,102 L46,86 L46,54 Z" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linejoin="round"/>
           <circle cx="72" cy="72" r="8" fill="${C.glyph}"/>`,
  },
  "ops-health": {
    cat: "connection",
    draw: `<rect x="44" y="44" width="56" height="56" rx="6" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <line x1="72" y1="56" x2="72" y2="72" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round"/>
           <line x1="72" y1="72" x2="84" y2="64" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>`,
  },
  "unlock": {
    cat: "connection",
    draw: `<rect x="52" y="68" width="40" height="32" rx="4" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <path d="M62,68 L62,56 A10,10 0 0 1 82,56" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round"/>`,
  },

  // ── Market Data (slate) ──
  "spy": {
    cat: "market",
    draw: `<text x="72" y="82" text-anchor="middle" font-family="SF Mono,Consolas,monospace" font-size="32" font-weight="600" fill="${C.glyph}">SPY</text>`,
  },
  "qqq": {
    cat: "market",
    draw: `<text x="72" y="82" text-anchor="middle" font-family="SF Mono,Consolas,monospace" font-size="32" font-weight="600" fill="${C.glyph}">QQQ</text>`,
  },
  "iwm": {
    cat: "market",
    draw: `<text x="72" y="82" text-anchor="middle" font-family="SF Mono,Consolas,monospace" font-size="32" font-weight="600" fill="${C.glyph}">IWM</text>`,
  },
  "trending": {
    cat: "market",
    draw: `<polyline points="40,96 64,64 80,80 104,48" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
           <polyline points="88,48 104,48 104,64" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "news": {
    cat: "market",
    draw: `<rect x="40" y="44" width="64" height="56" rx="4" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <line x1="52" y1="60" x2="92" y2="60" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="52" y1="72" x2="80" y2="72" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="52" y1="84" x2="72" y2="84" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>`,
  },
  "earnings": {
    cat: "market",
    draw: `<polyline points="40,92 60,60 76,76 96,44 104,44" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
           <circle cx="96" cy="44" r="6" fill="${C.emerald}" stroke="none"/>`,
  },
  "financials": {
    cat: "market",
    draw: `<rect x="44" y="76" width="16" height="20" rx="2" fill="${C.glyph}"/>
           <rect x="64" y="60" width="16" height="36" rx="2" fill="${C.glyph}"/>
           <rect x="84" y="48" width="16" height="48" rx="2" fill="${C.glyph}"/>`,
  },
  "options": {
    cat: "market",
    draw: `<rect x="44" y="48" width="56" height="48" rx="4" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <line x1="44" y1="64" x2="100" y2="64" stroke="${C.glyph}" stroke-width="3"/>
           <line x1="72" y1="48" x2="72" y2="96" stroke="${C.glyph}" stroke-width="3"/>`,
  },
  "search": {
    cat: "market",
    draw: `<circle cx="64" cy="64" r="18" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <line x1="77" y1="77" x2="100" y2="100" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round"/>`,
  },
  "indicators": {
    cat: "market",
    draw: `<circle cx="72" cy="72" r="28" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <line x1="72" y1="72" x2="72" y2="52" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round"/>
           <line x1="72" y1="72" x2="88" y2="60" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>`,
  },

  // ── Eval Engine (purple) ──
  "eval": {
    cat: "eval",
    draw: `<circle cx="72" cy="60" r="16" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <path d="M56,80 Q72,96 88,80" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round"/>
           <circle cx="66" cy="58" r="3" fill="${C.glyph}"/>
           <circle cx="78" cy="58" r="3" fill="${C.glyph}"/>`,
  },
  "drift": {
    cat: "eval",
    draw: `<path d="M36,72 Q52,48 72,72 Q92,96 108,72" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round"/>
           <path d="M36,72 Q52,96 72,72 Q92,48 108,72" fill="none" stroke="${C.muted}" stroke-width="2" stroke-dasharray="4,4" stroke-linecap="round"/>`,
  },
  "edge": {
    cat: "eval",
    draw: `<polygon points="72,40 100,72 72,104 44,72" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linejoin="round"/>
           <polygon points="72,56 86,72 72,88 58,72" fill="${C.glyph}" opacity="0.3"/>`,
  },
  "daily": {
    cat: "eval",
    draw: `<rect x="44" y="48" width="56" height="48" rx="4" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <line x1="44" y1="64" x2="100" y2="64" stroke="${C.glyph}" stroke-width="3"/>
           <line x1="60" y1="48" x2="60" y2="56" stroke="${C.glyph}" stroke-width="3"/>
           <line x1="84" y1="48" x2="84" y2="56" stroke="${C.glyph}" stroke-width="3"/>`,
  },
  "weights": {
    cat: "eval",
    draw: `<line x1="72" y1="40" x2="72" y2="52" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round"/>
           <line x1="48" y1="64" x2="96" y2="64" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round"/>
           <circle cx="48" cy="80" r="10" fill="none" stroke="${C.glyph}" stroke-width="3"/>
           <circle cx="96" cy="80" r="10" fill="none" stroke="${C.glyph}" stroke-width="3"/>`,
  },
  "holly": {
    cat: "eval",
    draw: `<rect x="48" y="44" width="48" height="56" rx="6" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <circle cx="64" cy="64" r="4" fill="${C.glyph}"/>
           <circle cx="80" cy="64" r="4" fill="${C.glyph}"/>
           <line x1="60" y1="80" x2="84" y2="80" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>`,
  },
  "holly-exits": {
    cat: "eval",
    draw: `<polyline points="40,80 60,60 76,72 100,44" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
           <line x1="100" y1="44" x2="100" y2="96" stroke="${C.glyph}" stroke-width="2" stroke-dasharray="4,4"/>
           <circle cx="100" cy="44" r="5" fill="${C.emerald}"/>`,
  },
  "exit-autopsy": {
    cat: "eval",
    draw: `<circle cx="72" cy="68" r="24" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <line x1="72" y1="52" x2="72" y2="68" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="72" y1="68" x2="84" y2="80" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="60" y1="44" x2="84" y2="44" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>`,
  },
  "signals": {
    cat: "eval",
    draw: `<line x1="72" y1="96" x2="72" y2="56" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round"/>
           <path d="M56,64 A20,20 0 0 1 88,64" fill="none" stroke="${C.glyph}" stroke-width="3"/>
           <path d="M48,56 A28,28 0 0 1 96,56" fill="none" stroke="${C.glyph}" stroke-width="3"/>`,
  },
  "regime": {
    cat: "eval",
    draw: `<rect x="44" y="52" width="56" height="12" rx="3" fill="${C.glyph}" opacity="0.3"/>
           <rect x="44" y="68" width="56" height="12" rx="3" fill="${C.glyph}" opacity="0.5"/>
           <rect x="44" y="84" width="56" height="12" rx="3" fill="${C.glyph}" opacity="0.8"/>`,
  },
  "tradersync": {
    cat: "eval",
    draw: `<path d="M48,72 A24,24 0 0 1 96,72" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <path d="M48,72 A24,24 0 0 0 96,72" fill="none" stroke="${C.muted}" stroke-width="4" stroke-dasharray="6,4"/>
           <circle cx="72" cy="72" r="4" fill="${C.glyph}"/>`,
  },

  // ── Orders / Execution (red) ──
  "orders": {
    cat: "orders",
    draw: `<rect x="48" y="40" width="48" height="60" rx="4" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <line x1="60" y1="56" x2="84" y2="56" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="60" y1="68" x2="84" y2="68" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="60" y1="80" x2="76" y2="80" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>`,
  },
  "open-orders": {
    cat: "orders",
    draw: `<rect x="48" y="44" width="48" height="56" rx="4" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <line x1="60" y1="60" x2="84" y2="60" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="60" y1="72" x2="84" y2="72" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <circle cx="72" cy="84" r="3" fill="${C.amber}"/>`,
  },
  "filled": {
    cat: "orders",
    draw: `<rect x="48" y="44" width="48" height="56" rx="4" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <polyline points="60,72 68,80 84,60" fill="none" stroke="${C.emerald}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "executions": {
    cat: "orders",
    draw: `<rect x="44" y="44" width="56" height="56" rx="4" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <line x1="56" y1="60" x2="88" y2="60" stroke="${C.glyph}" stroke-width="2"/>
           <line x1="56" y1="72" x2="88" y2="72" stroke="${C.glyph}" stroke-width="2"/>
           <line x1="56" y1="84" x2="88" y2="84" stroke="${C.glyph}" stroke-width="2"/>`,
  },
  "history": {
    cat: "orders",
    draw: `<circle cx="72" cy="72" r="24" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <polyline points="72,56 72,72 84,80" fill="none" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "flatten": {
    cat: "orders",
    draw: `<rect x="40" y="40" width="64" height="64" rx="8" fill="${C.red}" opacity="0.15"/>
           <line x1="48" y1="72" x2="96" y2="72" stroke="${C.glyph}" stroke-width="5" stroke-linecap="round"/>
           <polyline points="52,56 52,72" fill="none" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <polyline points="92,56 92,72" fill="none" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>`,
  },
  "cancel": {
    cat: "orders",
    draw: `<circle cx="72" cy="72" r="24" fill="${C.red}" opacity="0.15"/>
           <line x1="58" y1="58" x2="86" y2="86" stroke="${C.glyph}" stroke-width="5" stroke-linecap="round"/>
           <line x1="86" y1="58" x2="58" y2="86" stroke="${C.glyph}" stroke-width="5" stroke-linecap="round"/>`,
  },
  "lock": {
    cat: "orders",
    draw: `<rect x="52" y="68" width="40" height="32" rx="4" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <path d="M62,68 L62,56 A10,10 0 0 1 82,56 L82,68" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <circle cx="72" cy="82" r="4" fill="${C.glyph}"/>`,
  },
  "reset": {
    cat: "orders",
    draw: `<path d="M96,72 A24,24 0 1 1 72,48" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round"/>
           <polyline points="72,36 72,52 86,52" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  },

  // ── Portfolio (amber) ──
  "account": {
    cat: "portfolio",
    draw: `<text x="72" y="84" text-anchor="middle" font-family="SF Mono,Consolas,monospace" font-size="40" font-weight="600" fill="${C.glyph}">$</text>`,
  },
  "pnl": {
    cat: "portfolio",
    draw: `<rect x="48" y="80" width="12" height="16" rx="2" fill="${C.glyph}" opacity="0.5"/>
           <rect x="66" y="60" width="12" height="36" rx="2" fill="${C.glyph}" opacity="0.7"/>
           <rect x="84" y="48" width="12" height="48" rx="2" fill="${C.glyph}"/>`,
  },
  "positions": {
    cat: "portfolio",
    draw: `<rect x="44" y="48" width="24" height="20" rx="3" fill="none" stroke="${C.glyph}" stroke-width="3"/>
           <rect x="76" y="48" width="24" height="20" rx="3" fill="none" stroke="${C.glyph}" stroke-width="3"/>
           <rect x="44" y="76" width="24" height="20" rx="3" fill="none" stroke="${C.glyph}" stroke-width="3"/>
           <rect x="76" y="76" width="24" height="20" rx="3" fill="none" stroke="${C.glyph}" stroke-width="3"/>`,
  },
  "exposure": {
    cat: "portfolio",
    draw: `<circle cx="72" cy="72" r="24" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <path d="M72,48 A24,24 0 0 1 96,72 L72,72 Z" fill="${C.glyph}" opacity="0.4"/>`,
  },
  "stress-test": {
    cat: "portfolio",
    draw: `<polyline points="40,48 56,80 72,56 88,88 104,52" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
           <line x1="40" y1="96" x2="104" y2="96" stroke="${C.glyph}" stroke-width="2" stroke-dasharray="4,4"/>`,
  },
  "risk-config": {
    cat: "portfolio",
    draw: `<line x1="52" y1="52" x2="52" y2="92" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="72" y1="52" x2="72" y2="92" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="92" y1="52" x2="92" y2="92" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <circle cx="52" cy="64" r="6" fill="${C.bg}" stroke="${C.glyph}" stroke-width="3"/>
           <circle cx="72" cy="80" r="6" fill="${C.bg}" stroke="${C.glyph}" stroke-width="3"/>
           <circle cx="92" cy="68" r="6" fill="${C.bg}" stroke="${C.glyph}" stroke-width="3"/>`,
  },
  "flatten-config": {
    cat: "portfolio",
    draw: `<circle cx="72" cy="68" r="24" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <polyline points="72,52 72,68 84,76" fill="none" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
           <line x1="72" y1="96" x2="72" y2="100" stroke="${C.amber}" stroke-width="4" stroke-linecap="round"/>`,
  },
  "size-pos": {
    cat: "portfolio",
    draw: `<rect x="48" y="48" width="48" height="48" rx="4" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <line x1="48" y1="72" x2="96" y2="72" stroke="${C.glyph}" stroke-width="2" stroke-dasharray="4,4"/>
           <line x1="72" y1="48" x2="72" y2="96" stroke="${C.glyph}" stroke-width="2" stroke-dasharray="4,4"/>
           <polyline points="56,64 64,56" fill="none" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <polyline points="80,80 88,88" fill="none" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>`,
  },

  // ── Tools / Utility (slate) ──
  "journal": {
    cat: "utility",
    draw: `<rect x="48" y="40" width="48" height="60" rx="4" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <line x1="56" y1="40" x2="56" y2="100" stroke="${C.glyph}" stroke-width="3"/>
           <line x1="64" y1="56" x2="88" y2="56" stroke="${C.glyph}" stroke-width="2" stroke-linecap="round"/>
           <line x1="64" y1="68" x2="84" y2="68" stroke="${C.glyph}" stroke-width="2" stroke-linecap="round"/>
           <line x1="64" y1="80" x2="80" y2="80" stroke="${C.glyph}" stroke-width="2" stroke-linecap="round"/>`,
  },
  "collab": {
    cat: "utility",
    draw: `<rect x="40" y="48" width="40" height="28" rx="6" fill="none" stroke="${C.glyph}" stroke-width="3"/>
           <rect x="64" y="68" width="40" height="28" rx="6" fill="none" stroke="${C.glyph}" stroke-width="3"/>
           <circle cx="54" cy="62" r="2" fill="${C.glyph}"/>
           <circle cx="62" cy="62" r="2" fill="${C.glyph}"/>
           <circle cx="78" cy="82" r="2" fill="${C.glyph}"/>
           <circle cx="86" cy="82" r="2" fill="${C.glyph}"/>`,
  },
  "import": {
    cat: "utility",
    draw: `<polyline points="56,56 72,72 88,56" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
           <line x1="72" y1="72" x2="72" y2="44" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round"/>
           <path d="M48,84 L48,96 L96,96 L96,84" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "import-history": {
    cat: "utility",
    draw: `<circle cx="72" cy="68" r="24" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <polyline points="72,52 72,68 84,76" fill="none" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
           <polyline points="60,96 72,84 84,96" fill="none" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "divoom": {
    cat: "utility",
    draw: `<rect x="44" y="44" width="56" height="44" rx="4" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <rect x="52" y="52" width="8" height="8" rx="1" fill="${C.emerald}" opacity="0.6"/>
           <rect x="64" y="52" width="8" height="8" rx="1" fill="${C.glyph}" opacity="0.4"/>
           <rect x="76" y="52" width="8" height="8" rx="1" fill="${C.amber}" opacity="0.6"/>
           <rect x="52" y="64" width="8" height="8" rx="1" fill="${C.glyph}" opacity="0.4"/>
           <rect x="64" y="64" width="8" height="8" rx="1" fill="${C.purple}" opacity="0.6"/>
           <rect x="76" y="64" width="8" height="8" rx="1" fill="${C.glyph}" opacity="0.4"/>
           <line x1="60" y1="96" x2="84" y2="96" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>`,
  },
  "divoom-bright": {
    cat: "utility",
    draw: `<circle cx="72" cy="72" r="16" fill="${C.glyph}" opacity="0.3"/>
           <circle cx="72" cy="72" r="8" fill="${C.glyph}"/>
           <line x1="72" y1="44" x2="72" y2="36" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="72" y1="100" x2="72" y2="108" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="44" y1="72" x2="36" y2="72" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="100" y1="72" x2="108" y2="72" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="52" y1="52" x2="46" y2="46" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="92" y1="92" x2="98" y2="98" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>`,
  },
  "debug": {
    cat: "utility",
    draw: `<ellipse cx="72" cy="76" rx="20" ry="24" fill="none" stroke="${C.glyph}" stroke-width="4"/>
           <line x1="72" y1="52" x2="72" y2="100" stroke="${C.glyph}" stroke-width="2"/>
           <line x1="48" y1="68" x2="56" y2="64" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="96" y1="68" x2="88" y2="64" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="48" y1="84" x2="56" y2="80" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="96" y1="84" x2="88" y2="80" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="62" y1="52" x2="58" y2="44" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>
           <line x1="82" y1="52" x2="86" y2="44" stroke="${C.glyph}" stroke-width="3" stroke-linecap="round"/>`,
  },
  "ops-log": {
    cat: "utility",
    draw: `<text x="72" y="80" text-anchor="middle" font-family="SF Mono,Consolas,monospace" font-size="22" font-weight="500" fill="${C.glyph}">&gt;_</text>
           <rect x="44" y="48" width="56" height="48" rx="4" fill="none" stroke="${C.glyph}" stroke-width="4"/>`,
  },

  // ── Navigation (muted) ──
  "back": {
    cat: "nav",
    draw: `<polyline points="80,48 56,72 80,96" fill="none" stroke="${C.glyph}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "dashboard": {
    cat: "nav",
    draw: `<rect x="44" y="48" width="24" height="20" rx="3" fill="none" stroke="${C.glyph}" stroke-width="3"/>
           <rect x="76" y="48" width="24" height="20" rx="3" fill="none" stroke="${C.glyph}" stroke-width="3"/>
           <rect x="44" y="76" width="56" height="20" rx="3" fill="none" stroke="${C.glyph}" stroke-width="3"/>`,
  },
  "folder-trade": {
    cat: "nav",
    draw: `<path d="M40,56 L40,96 L104,96 L104,56 L76,56 L72,48 L40,48 Z" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linejoin="round"/>
           <line x1="64" y1="68" x2="80" y2="68" stroke="${C.red}" stroke-width="4" stroke-linecap="round"/>
           <line x1="72" y1="60" x2="72" y2="76" stroke="${C.red}" stroke-width="4" stroke-linecap="round"/>`,
  },
  "folder-analytics": {
    cat: "nav",
    draw: `<path d="M40,56 L40,96 L104,96 L104,56 L76,56 L72,48 L40,48 Z" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linejoin="round"/>
           <polyline points="56,84 68,68 80,76 92,64" fill="none" stroke="${C.purple}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "folder-data": {
    cat: "nav",
    draw: `<path d="M40,56 L40,96 L104,96 L104,56 L76,56 L72,48 L40,48 Z" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linejoin="round"/>
           <ellipse cx="72" cy="72" rx="16" ry="6" fill="none" stroke="${C.slate}" stroke-width="3"/>
           <line x1="56" y1="72" x2="56" y2="84" stroke="${C.slate}" stroke-width="3"/>
           <line x1="88" y1="72" x2="88" y2="84" stroke="${C.slate}" stroke-width="3"/>
           <ellipse cx="72" cy="84" rx="16" ry="6" fill="none" stroke="${C.slate}" stroke-width="3"/>`,
  },

  // ── Screener (amber) ──
  "screener-gainers": {
    cat: "portfolio",
    draw: `<polyline points="48,88 72,56 96,88" fill="none" stroke="${C.glyph}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
           <polyline points="60,48 72,36 84,48" fill="none" stroke="${C.emerald}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  "screener-actives": {
    cat: "portfolio",
    draw: `<polyline points="36,72 52,72 60,52 68,92 76,44 84,84 92,64 108,64" fill="none" stroke="${C.glyph}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
};


// ── SVG template ───────────────────────────────────────────────

function buildSvg(name, { cat, draw }) {
  const accent = CAT[cat] || C.slate;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">
  <!-- MDB StreamDeck icon: ${name} (${cat}) -->
  <rect width="144" height="144" rx="16" fill="${C.bg}"/>
  <rect y="0" width="144" height="5" rx="2.5" fill="${accent}"/>
  ${draw}
</svg>
`;
}

// ── Generate ───────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

let count = 0;
for (const [name, def] of Object.entries(icons)) {
  const svg = buildSvg(name, def);
  const file = join(OUT_DIR, `${name}.svg`);
  writeFileSync(file, svg);
  count++;
}

console.log(`Generated ${count} SVG icons in ${OUT_DIR}`);
console.log(`\nCategory breakdown:`);
const catCount = {};
for (const def of Object.values(icons)) {
  catCount[def.cat] = (catCount[def.cat] || 0) + 1;
}
for (const [cat, n] of Object.entries(catCount).sort((a, b) => b[1] - a[1])) {
  const color = CAT[cat];
  console.log(`  ${cat.padEnd(14)} ${String(n).padStart(2)} icons  (accent: ${color})`);
}
