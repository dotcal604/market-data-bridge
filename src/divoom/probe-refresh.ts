/**
 * Canvas Refresh Rate Stress Test
 *
 * Renders the grid layout once, serves the JPEG, then pushes it
 * to the TimesFrame at decreasing intervals: 10s → 8s → 6s → 4s → 2s.
 *
 * Each rate runs for ~5 cycles so you can watch the panel and see
 * where the device starts dropping frames or flickering.
 *
 * Usage:
 *   npx tsx src/divoom/probe-refresh.ts           # dark (transparent glass)
 *   npx tsx src/divoom/probe-refresh.ts --white    # white (opaque panel)
 *   npx tsx src/divoom/probe-refresh.ts --push     # single push, no stress test
 *   npx tsx src/divoom/probe-refresh.ts --white --push
 */

import { createServer } from "http";
import { registerWidgets, renderLayout } from "./canvas/engine.js";
import { allWidgets } from "./canvas/widgets.js";
import { DEFAULT_CONFIG, LIGHT_CONFIG } from "./canvas/types.js";
import type { Slot, CanvasConfig } from "./canvas/types.js";

const args = process.argv.slice(2);
const useWhite = args.includes("--white");
const pushOnly = args.includes("--push");
const config: CanvasConfig = useWhite ? LIGHT_CONFIG : DEFAULT_CONFIG;
const themeName = useWhite ? "WHITE (opaque)" : "DARK (transparent)";

// ─── Config ──────────────────────────────────────────────────

const DEVICE_IP = process.env.DIVOOM_DEVICE_IP ?? "192.168.0.48";
const DEVICE_PORT = parseInt(process.env.DIVOOM_DEVICE_PORT ?? "9000", 10);
const SERVER_IP = "192.168.0.47"; // LAN IP the device fetches from
const SERVE_PORT = 9877;

const RATES_MS = [10_000, 8_000, 6_000, 4_000, 2_000];
const CYCLES_PER_RATE = 5;

// ─── Device command ──────────────────────────────────────────

async function pushToDevice(bgUrl: string): Promise<{ ok: boolean; ms: number }> {
  // Cache-bust: device firmware deduplicates by URL, so we append a
  // unique timestamp to force it to re-fetch the JPEG every cycle.
  const bustedUrl = `${bgUrl}?t=${Date.now()}`;
  const t0 = performance.now();
  try {
    const res = await fetch(`http://${DEVICE_IP}:${DEVICE_PORT}/divoom_api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        Command: "Device/EnterCustomControlMode",
        // Firmware may skip background fetch with empty DispList —
        // include one invisible text element to force full render.
        DispList: [{
          ID: 1,
          Type: "Text",
          StartX: 0, StartY: 0,
          Width: 1, Height: 1,
          Align: 0, FontSize: 1, FontID: 52,
          FontColor: "#000000", BgColor: "#000000",
          TextMessage: " ",
        }],
        BackgroudImageAddr: bustedUrl,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const ms = performance.now() - t0;
    return { ok: res.ok, ms };
  } catch {
    return { ok: false, ms: performance.now() - t0 };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  registerWidgets(allWidgets);

  // Layout: same as probe-canvas — full dashboard
  const layout: Slot[] = [
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
    { widget: "separator" },
    {
      widget: "sectors",
      params: {
        sectors: [
          { name: "TECH", chg: 1.8, leader: "NVDA" },
          { name: "HLTH", chg: 0.9, leader: "UNH" },
          { name: "FINL", chg: 0.3, leader: "JPM" },
          { name: "INDU", chg: 0.5, leader: "CAT" },
          { name: "CONS", chg: -0.2, leader: "AMZN" },
          { name: "ENER", chg: -1.1, leader: "XOM" },
          { name: "UTIL", chg: 0.1, leader: "NEE" },
          { name: "REAL", chg: -0.6, leader: "PLD" },
          { name: "MATL", chg: 0.4, leader: "LIN" },
          { name: "COMM", chg: 1.2, leader: "GOOGL" },
          { name: "STPL", chg: -0.3, leader: "PG" },
        ],
      },
    },
    { widget: "pnl" },
    { widget: "separator" },
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
    {
      widget: "gauge",
      params: { label: "RSI (14)", value: 58, max: 100, color: "#00CCEE", icon: "\uE628" },
    },
    {
      widget: "gauge",
      params: { label: "VIX", value: 17, max: 50, color: "#EEDD00", icon: "\uE4E0" },
    },
  ];

  // Render once
  console.log(`Theme: ${themeName}`);
  console.log("Rendering canvas...");
  const t0 = performance.now();
  const result = await renderLayout(layout, config);
  const renderMs = (performance.now() - t0).toFixed(0);
  console.log(`  Rendered ${result.rendered.length} widgets → ${(result.jpeg.length / 1024).toFixed(1)} KB in ${renderMs}ms\n`);

  // Serve the JPEG
  let fetchCount = 0;
  const server = createServer((req, res) => {
    fetchCount++;
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": result.jpeg.length });
    res.end(result.jpeg);
  });
  await new Promise<void>((r) => server.listen(SERVE_PORT, "0.0.0.0", r));
  const bgUrl = `http://${SERVER_IP}:${SERVE_PORT}/frame.jpg`;
  console.log(`Serving on ${bgUrl}`);
  console.log(`Device: ${DEVICE_IP}:${DEVICE_PORT}\n`);

  // Initial push to verify connection
  console.log("Testing device connection...");
  const test = await pushToDevice(bgUrl);
  if (!test.ok) {
    console.error("✗ Device unreachable! Check IP/power.");
    process.exit(1);
  }
  console.log(`✓ Device responded in ${test.ms.toFixed(0)}ms\n`);

  // --push mode: keep re-pushing every 10s so device stays in CustomControlMode
  if (pushOnly) {
    console.log(`═══════════════════════════════════════════════════════`);
    console.log(`  ${themeName} pushed to device — refreshing every 10s`);
    console.log(`  Image served at ${bgUrl}`);
    console.log(`  Press Ctrl+C to stop`);
    console.log(`═══════════════════════════════════════════════════════\n`);
    setInterval(async () => {
      const { ok, ms } = await pushToDevice(bgUrl);
      const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
      console.log(`  [${ts}] refresh ${ok ? "✓" : "✗"} ${ms.toFixed(0)}ms  fetches: ${fetchCount}`);
    }, 10_000);
    // Keep process alive
    await new Promise(() => {});
  }

  console.log("═══════════════════════════════════════════════════════");
  console.log("  REFRESH RATE STRESS TEST");
  console.log("  Watch the panel — note when it flickers or lags");
  console.log("═══════════════════════════════════════════════════════\n");

  // Run through each rate
  for (const rateMs of RATES_MS) {
    const rateSec = (rateMs / 1000).toFixed(0);
    console.log(`\n▸ ${rateSec}s interval  (${CYCLES_PER_RATE} cycles)`);
    console.log("  ──────────────────────────────────────");

    const times: number[] = [];
    let failures = 0;

    for (let i = 0; i < CYCLES_PER_RATE; i++) {
      const { ok, ms } = await pushToDevice(bgUrl);
      if (ok) {
        times.push(ms);
        console.log(`  cycle ${i + 1}/${CYCLES_PER_RATE}  push: ${ms.toFixed(0)}ms  fetches: ${fetchCount}`);
      } else {
        failures++;
        console.log(`  cycle ${i + 1}/${CYCLES_PER_RATE}  ✗ FAILED (${ms.toFixed(0)}ms)`);
      }

      // Wait the remaining interval (subtract the push time)
      const waitMs = Math.max(100, rateMs - ms);
      await sleep(waitMs);
    }

    const avg = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    const max = times.length > 0 ? Math.max(...times) : 0;
    console.log(`  ── avg: ${avg.toFixed(0)}ms  max: ${max.toFixed(0)}ms  failures: ${failures}/${CYCLES_PER_RATE}`);

    // Brief pause between rate changes so you can see the transition
    if (rateMs !== RATES_MS[RATES_MS.length - 1]) {
      console.log(`  (pausing 3s before next rate...)`);
      await sleep(3000);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  TEST COMPLETE");
  console.log(`  Total device fetches: ${fetchCount}`);
  console.log("═══════════════════════════════════════════════════════\n");

  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
