/**
 * Canvas Widget System — Probe Script
 *
 * Demonstrates the grid-based widget framework with auto-flow placement.
 * You just list widgets in order — the engine packs them onto the grid
 * using each widget's declared gridSize. No coordinates needed.
 *
 * Widget sizes are standardized:
 *   4×1 = full-width bar  (header, footer, separator)
 *   4×2 = full-width tile (indices, movers, news)
 *   2×2 = half-width tile (sparkline, sectors, pnl, positions)
 *   2×1 = small half-width (gauge)
 *
 * Grid: 4 columns × 12 rows on an 800×1280 canvas.
 * Auto-flow: left-to-right, top-to-bottom (like placing tiles).
 *
 * Usage: npx tsx src/divoom/probe-canvas.ts [--white] [--serve]
 */

import { resolve } from "path";
import { writeFileSync } from "fs";
import { registerWidgets, renderLayout } from "./canvas/engine.js";
import { allWidgets } from "./canvas/widgets.js";
import { DEFAULT_CONFIG } from "./canvas/types.js";
import type { Slot } from "./canvas/types.js";

// ─── Register all widget types ──────────────────────────────

registerWidgets(allWidgets);

// ─── Define layout ──────────────────────────────────────────
//
// Just list widgets in display order. The engine auto-flows them
// onto the 4-column grid using each widget's declared size.
//
// Two 2×2 widgets listed consecutively → placed side by side.
// A 4×2 widget → takes the full row (or next available full row).
// Two 2×1 gauges → sit side by side in one row.
//
// ┌──────────────────────────────────────┐
// │  header          [4×1]               │  ← auto row 0
// │  indices         [4×2]               │  ← auto rows 1-2
// │  sparkline SPY │ sparkline QQQ       │  ← auto rows 3-4 (two 2×2)
// │  separator       [4×1]               │  ← auto row 5
// │  sectors       │ pnl                 │  ← auto rows 6-7 (two 2×2)
// │  separator       [4×1]               │  ← auto row 8
// │  movers          [4×2]               │  ← auto rows 9-10
// │  RSI gauge     │ VIX gauge           │  ← auto row 11 (two 2×1)
// └──────────────────────────────────────┘

const layout: Slot[] = [
  // Full-width header bar
  {
    widget: "header",
    params: {
      session: "REGULAR",
      time: "10:42 ET",
      connections: [
        { label: "IBKR", ok: true },
        { label: "Yahoo", ok: true },
      ],
    },
  },

  // Market indices — full width
  {
    widget: "indices",
    params: {
      primary: [
        { sym: "SPY", val: "580.25", chg: "+0.48%", dir: 1 },
        { sym: "QQQ", val: "495.12", chg: "+0.72%", dir: 1 },
      ],
      secondary: [
        { sym: "DIA", val: "425.88", chg: "-0.15%", dir: -1 },
        { sym: "IWM", val: "198.45", chg: "+1.22%", dir: 1 },
        { sym: "VIX", val: "16.8", chg: "-4.2%", dir: -1 },
      ],
    },
  },

  // Two sparklines side by side (each 2×2 → auto-pack into same row)
  {
    widget: "sparkline",
    params: {
      label: "SPY 1mo",
      data: [565, 568, 570, 567, 572, 575, 573, 578, 580, 576, 582, 585, 583, 579, 581, 580, 578, 580, 583, 580, 577, 580],
      color: "#00CCEE",
    },
  },
  {
    widget: "sparkline",
    params: {
      label: "QQQ 1mo",
      data: [480, 483, 486, 482, 488, 491, 489, 494, 496, 493, 498, 495, 497, 500, 502, 499, 501, 498, 496, 495, 493, 495],
      color: "#00DD55",
    },
  },

  // Separator
  { widget: "separator" },

  // Sectors + P&L side by side (each 2×2)
  {
    widget: "sectors",
    params: {
      sectors: [
        { name: "TECH", chg: 1.8 },
        { name: "HLTH", chg: 0.9 },
        { name: "FINL", chg: 0.3 },
        { name: "CONS", chg: -0.2 },
        { name: "ENER", chg: -1.1 },
      ],
    },
  },
  { widget: "pnl" },

  // Separator
  { widget: "separator" },

  // Movers — full width
  {
    widget: "movers",
    params: {
      title: "TOP MOVERS",
      movers: [
        { sym: "AAOI", chg: "+56.88%", price: "$84.23", dir: 1, vol: 8.2 },
        { sym: "BWIN", chg: "+25.64%", price: "$23.23", dir: 1, vol: 4.5 },
        { sym: "RUN",  chg: "-35.11%", price: "$13.25", dir: -1, vol: 6.1 },
        { sym: "FIGR", chg: "-25.73%", price: "$25.28", dir: -1, vol: 2.3 },
      ],
    },
  },

  // Two gauges side by side (each 2×1 → pack into same row)
  {
    widget: "gauge",
    params: {
      label: "RSI (14)",
      value: 58,
      max: 100,
      color: "#00CCEE",
      icon: "\uE628",
    },
  },
  {
    widget: "gauge",
    params: {
      label: "VIX",
      value: 17,
      max: 50,
      color: "#EEDD00",
      icon: "\uE4E0",
    },
  },
];

// ─── Render ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const uniqueTypes = new Set(layout.map(s => s.widget)).size;
  console.log(`Canvas probe: ${layout.length} slots, ${uniqueTypes} widget types`);
  console.log(`Grid: ${DEFAULT_CONFIG.columns} columns × ${DEFAULT_CONFIG.rows} rows`);
  console.log(`Auto-flow: widgets declare their own size, engine packs them\n`);

  const useWhiteBg = process.argv.includes("--white");
  if (useWhiteBg) console.log("  Background: WHITE (opaque on panel)");
  else console.log("  Background: BLACK (transparent glass)");
  console.log();

  // White bg: swap text colors for contrast (white text → dark, etc.)
  const lightPalette = {
    ...DEFAULT_CONFIG.palette,
    bg: "#FFFFFF",
    white: "#111111",
    softWhite: "#333333",
    dimGray: "#DDDDDD",
    gray: "#666666",
  };

  const config = useWhiteBg
    ? { ...DEFAULT_CONFIG, palette: lightPalette }
    : DEFAULT_CONFIG;

  const result = await renderLayout(layout, config);

  console.log(`Rendered: ${result.rendered.length} widgets → ${(result.jpeg.length / 1024).toFixed(1)} KB JPEG`);
  console.log(`  Widgets: ${result.rendered.join(", ")}`);
  if (result.skipped.length > 0) {
    console.log(`  Skipped slots: ${result.skipped.join(", ")}`);
  }
  console.log(`  Canvas used: ${result.usedHeight}px of 1280px`);

  // Save preview
  const outPath = resolve(import.meta.dirname ?? ".", "../../data/canvas-preview.jpg");
  writeFileSync(outPath, result.jpeg);
  console.log(`\nPreview saved: ${outPath}`);

  // Optional: serve for device
  const serve = process.argv.includes("--serve");
  if (serve) {
    const { createServer } = await import("http");
    const server = createServer((req, res) => {
      console.log(`  Device fetched: ${req.url}`);
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": result.jpeg.length });
      res.end(result.jpeg);
    });
    await new Promise<void>((r) => server.listen(9877, "0.0.0.0", r));
    console.log("Serving JPEG on http://0.0.0.0:9877/frame.jpg  (Ctrl-C to stop)");
  }
}

main().catch(console.error);
