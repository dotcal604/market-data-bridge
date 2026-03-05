/**
 * Proof-of-concept: Full-frame server-rendered display
 *
 * MAXIMUM TRANSPARENCY mode — pure black canvas (= clear glass),
 * only text characters and chart lines glow as colored pixels.
 * No panel backgrounds, no tinted rectangles. Just floating data.
 *
 * Fonts: JetBrains Mono (text) + Phosphor Icons Light (icons)
 * Creative Unicode: block bars ▁▂▃▄▅▆▇█, density fills ░▒▓, status dots ● ○
 * Renders into a single 800x1280 JPEG, pushes via BackgroudImageAddr.
 *
 * Usage:
 *   npx tsx src/divoom/probe-fullframe.ts
 */

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import sharp from "sharp";
import { resolve } from "path";

const DEVICE_IP = "192.168.0.48";
const DEVICE_PORT = 9000;
const DEVICE_URL = `http://${DEVICE_IP}:${DEVICE_PORT}/divoom_api`;

const W = 800;
const H = 1280;
const PAD = 24;

// ─── Register Fonts ─────────────────────────────────────────

const fontDir = resolve(import.meta.dirname ?? ".", "../../data/fonts");

// Text fonts
GlobalFonts.registerFromPath(resolve(fontDir, "JetBrainsMono-Regular.ttf"), "JBMono");
GlobalFonts.registerFromPath(resolve(fontDir, "JetBrainsMono-Bold.ttf"), "JBMono Bold");
GlobalFonts.registerFromPath(resolve(fontDir, "JetBrainsMono-Medium.ttf"), "JBMono Medium");

// Icon fonts — Phosphor (Light for glass aesthetic, Regular for section headers)
GlobalFonts.registerFromPath(resolve(fontDir, "Phosphor-Light.ttf"), "Ph Light");
GlobalFonts.registerFromPath(resolve(fontDir, "Phosphor.ttf"), "Ph");
GlobalFonts.registerFromPath(resolve(fontDir, "Phosphor-Bold.ttf"), "Ph Bold");

console.log("Fonts registered:", {
  JBMono: GlobalFonts.has("JBMono"),
  "Ph Light": GlobalFonts.has("Ph Light"),
  Ph: GlobalFonts.has("Ph"),
});

// ─── Color Palette (glass-optimized) ────────────────────────

const C = {
  bg: "#000000",          // black = transparent on glass
  green: "#00DD55",       // slightly brighter for glass
  red: "#EE3322",
  cyan: "#00CCEE",
  yellow: "#EEDD00",
  orange: "#FF9922",
  white: "#FFFFFF",
  gray: "#777777",        // brighter gray for glass readability
  dimGray: "#333333",
  magenta: "#FF44FF",
  softWhite: "#CCCCCC",   // less glaring than pure white
};

// ─── Phosphor Icon Unicode Codepoints ────────────────────────
// Sourced from @phosphor-icons/web v2.1.1 CSS
// Light weight = thin strokes = minimal opaque area on glass

const Ph = {
  chartLine:      "\uE154",   // ph-chart-line
  chartLineUp:    "\uE156",   // ph-chart-line-up
  trendUp:        "\uE4AE",   // ph-trend-up
  trendDown:      "\uE4AC",   // ph-trend-down
  caretUp:        "\uE13C",   // ph-caret-up
  caretDown:      "\uE136",   // ph-caret-down
  lightning:      "\uE2DE",   // ph-lightning (= bolt)
  clock:          "\uE19A",   // ph-clock
  timer:          "\uE492",   // ph-timer
  currencyDollar: "\uE550",   // ph-currency-dollar
  shield:         "\uE40A",   // ph-shield
  fire:           "\uE242",   // ph-fire
  newspaper:      "\uE344",   // ph-newspaper
  link:           "\uE2E2",   // ph-link
  cellSignal:     "\uE142",   // ph-cell-signal-full
  warning:        "\uE4E0",   // ph-warning
  broadcast:      "\uE0F2",   // ph-broadcast
  plugConnected:  "\uEB5A",   // ph-plugs-connected
  eye:            "\uE220",   // ph-eye
  gauge:          "\uE628",   // ph-gauge
  circle:         "\uE18A",   // ph-circle
  checkCircle:    "\uE184",   // ph-check-circle
};

// ─── Drawing Helpers ────────────────────────────────────────

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  size: number,
  font = "JBMono",
) {
  ctx.font = `${size}px '${font}'`;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Draw colored text segments, optionally mixing fonts per-segment */
function drawColoredLine(
  ctx: CanvasRenderingContext2D,
  segments: [string, string, string?][],  // [text, color, font?]
  x: number,
  y: number,
  size: number,
  defaultFont = "JBMono",
) {
  let curX = x;
  for (const [text, color, font] of segments) {
    ctx.font = `${size}px '${font ?? defaultFont}'`;
    ctx.fillStyle = color;
    ctx.fillText(text, curX, y);
    curX += ctx.measureText(text).width;
  }
}

/** Mini sparkline from data array */
function drawSparkline(
  ctx: CanvasRenderingContext2D,
  data: number[],
  x: number, y: number, w: number, h: number,
  color: string, lineWidth = 2,
) {
  if (data.length < 2) return;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = w / (data.length - 1);

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const px = x + i * stepX;
    const py = y + h - ((data[i] - min) / range) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Subtle glow fill under the line
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = color;
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1.0;
}

/** Thin separator — barely visible on glass */
function drawSep(ctx: CanvasRenderingContext2D, y: number) {
  ctx.strokeStyle = C.dimGray;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
}

// ─── Unicode Creative Helpers ─────────────────────────────────
// Block elements ▁▂▃▄▅▆▇█ — 8 height levels per character
// Density fills ░▒▓█ — 4 density levels
// Status dots ● ○ — binary state indicators

const BLOCK_CHARS = " ▁▂▃▄▅▆▇█";  // index 0=empty, 8=full

/** Block bar: ████░░░░ with partial fill + empty shade */
function toBlockBar(value: number, max: number, width: number): string {
  const filled = Math.round((value / max) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

/** Vertical bars from data array — each point becomes ▁-█ */
function toVerticalBars(data: number[]): string {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  return data.map((v) => {
    const level = Math.round(((v - min) / range) * 8);
    return BLOCK_CHARS[Math.max(1, Math.min(8, level))];
  }).join("");
}

/** Progress bar: [████████░░] with percentage fill */
function toProgressBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

// ─── Render Full Frame ──────────────────────────────────────

async function renderFrame(): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

  // Pure black canvas = fully transparent glass
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "alphabetic";

  let cursor = PAD + 8;

  // ── Header ──
  // Status dots (● = connected, ○ = disconnected) + session badge
  drawColoredLine(ctx, [
    ["● ", C.green],                           // IBKR connected
    ["● ", C.green],                           // Yahoo connected
    ["○ ", C.gray],                            // Schwab disconnected
    ["  ", C.bg],
    ["CLOSED", C.orange, "JBMono Bold"],
    ["  ", C.bg],
    [Ph.broadcast, C.green, "Ph Light"],
    [" LIVE", C.green],
    ["   ", C.bg],
    [Ph.clock, C.gray, "Ph Light"],
    [" 02:45 ET", C.gray],
  ], PAD, cursor + 28, 26);
  cursor += 52;

  drawSep(ctx, cursor);
  cursor += 16;

  // ── Indices ──
  const indices = [
    { sym: "SPY", val: "580.25", chg: "-0.48%", dir: -1 },
    { sym: "QQQ", val: "495.12", chg: "-0.32%", dir: -1 },
    { sym: "DIA", val: "425.88", chg: "-1.05%", dir: -1 },
    { sym: "IWM", val: "198.45", chg: "-1.72%", dir: -1 },
    { sym: "VIX", val: "20.1", chg: "+6.6%", dir: 1 },
  ];

  // Row 1: SPY + QQQ (large, prominent)
  for (let i = 0; i < 2; i++) {
    const idx = indices[i];
    const col = idx.dir >= 0 ? C.green : C.red;
    const arrow = idx.dir >= 0 ? Ph.trendUp : Ph.trendDown;
    const xOff = PAD + i * 380;
    drawColoredLine(ctx, [
      [idx.sym, C.cyan],
      [` ${idx.val} `, C.white],
      [arrow, col, "Ph Light"],
      [` ${idx.chg}`, col],
    ], xOff, cursor + 24, 24);
  }
  cursor += 36;

  // Row 2: DIA + IWM + VIX (smaller)
  for (let i = 2; i < 5; i++) {
    const idx = indices[i];
    const col = idx.dir >= 0 ? C.green : C.red;
    const arrow = idx.dir >= 0 ? Ph.trendUp : Ph.trendDown;
    const xOff = PAD + (i - 2) * 260;
    drawColoredLine(ctx, [
      [idx.sym, C.cyan],
      [` ${idx.val} `, C.softWhite],
      [arrow, col, "Ph Light"],
      [` ${idx.chg}`, col],
    ], xOff, cursor + 20, 18);
  }
  cursor += 32;

  drawSep(ctx, cursor);
  cursor += 16;

  // ── Sparkline chart ──
  const mockPrices = [82, 84, 81, 85, 88, 86, 90, 92, 89, 87, 91, 94, 96, 93, 95, 98, 97, 99, 101, 100, 103, 105];
  drawColoredLine(ctx, [
    [Ph.chartLineUp, C.cyan, "Ph Light"],
    [" SPY 1mo", C.gray],
  ], PAD, cursor + 14, 14);
  drawSparkline(ctx, mockPrices, PAD, cursor + 24, W - PAD * 2, 160, C.cyan, 2.5);

  // Price labels floating on chart
  const maxP = Math.max(...mockPrices);
  const minP = Math.min(...mockPrices);
  drawText(ctx, `$${maxP}`, W - PAD - 56, cursor + 38, C.green, 13);
  drawText(ctx, `$${minP}`, W - PAD - 56, cursor + 176, C.red, 13);
  cursor += 196;

  drawSep(ctx, cursor);
  cursor += 16;

  // ── Sector Strength (block bars) ──
  drawColoredLine(ctx, [
    [Ph.chartLine, C.gray, "Ph Light"],
    [" SECTORS", C.gray],
  ], PAD, cursor + 16, 14);
  cursor += 28;

  const sectors = [
    { name: "TECH", chg: 1.2 },
    { name: "HLTH", chg: 0.6 },
    { name: "FINL", chg: 0.2 },
    { name: "ENER", chg: -0.8 },
    { name: "UTIL", chg: -1.5 },
  ];

  for (const s of sectors) {
    const col = s.chg >= 0 ? C.green : C.red;
    const barWidth = Math.round(Math.abs(s.chg) / 2.0 * 12);  // scale to ~12 chars max
    const bar = "█".repeat(Math.max(1, barWidth));
    drawColoredLine(ctx, [
      [s.name, C.softWhite],
      [" ", C.bg],
      [bar, col],
      [" ", C.bg],
      [`${s.chg >= 0 ? "+" : ""}${s.chg.toFixed(1)}%`, col],
    ], PAD + 8, cursor + 18, 18);
    cursor += 24;
  }
  cursor += 8;

  drawSep(ctx, cursor);
  cursor += 16;

  // ── Positions ──
  drawColoredLine(ctx, [
    [Ph.shield, C.gray, "Ph Light"],
    [" POSITIONS", C.gray],
  ], PAD, cursor + 16, 14);
  cursor += 28;

  const positions = [
    { sym: "PLTR", qty: "45sh", pnl: "+$142", pnlDir: 1, stop: "stp $82.5" },
    { sym: "NVDA", qty: "20sh", pnl: "-$38", pnlDir: -1, stop: "stp $410" },
    { sym: "AAPL", qty: "15sh", pnl: "+$21", pnlDir: 1, stop: "none" },
  ];

  for (const pos of positions) {
    const pnlColor = pos.pnlDir >= 0 ? C.green : C.red;
    const stopColor = pos.stop === "none" ? C.orange : C.gray;
    const pnlArrow = pos.pnlDir >= 0 ? Ph.trendUp : Ph.trendDown;
    drawColoredLine(ctx, [
      [pos.sym, C.white],
      [` ${pos.qty} `, C.gray],
      [pnlArrow, pnlColor, "Ph Light"],
      [` ${pos.pnl}`, pnlColor],
      [`  ${pos.stop}`, stopColor],
    ], PAD + 8, cursor + 22, 22);
    cursor += 30;
  }
  cursor += 12;

  drawSep(ctx, cursor);
  cursor += 16;

  // ── Day P&L summary ──
  drawColoredLine(ctx, [
    [Ph.currencyDollar, C.green, "Ph Light"],
    [" Day ", C.gray],
    ["+$342", C.green, "JBMono Bold"],
    ["    Net ", C.gray],
    ["$24.1K", C.white, "JBMono Bold"],
  ], PAD, cursor + 28, 24);
  cursor += 36;

  // Deployed % progress bar
  const deployed = 73;
  const deployedBar = toProgressBar(deployed, 20);
  drawColoredLine(ctx, [
    [Ph.gauge, C.cyan, "Ph Light"],
    [" Deployed [", C.gray],
    [deployedBar, C.cyan],
    ["] ", C.gray],
    [`${deployed}%`, C.white, "JBMono Bold"],
  ], PAD + 8, cursor + 18, 16);
  cursor += 24;

  // Risk heat bar
  const riskPct = 35;
  const riskBar = toProgressBar(riskPct, 20);
  drawColoredLine(ctx, [
    [Ph.warning, C.orange, "Ph Light"],
    [" Risk    [", C.gray],
    [riskBar, C.orange],
    ["] ", C.gray],
    ["MED", C.orange, "JBMono Bold"],
  ], PAD + 8, cursor + 18, 16);
  cursor += 32;

  drawSep(ctx, cursor);
  cursor += 16;

  // ── Movers ──
  drawColoredLine(ctx, [
    [Ph.fire, C.magenta, "Ph Light"],
    [" TOP MOVERS", C.magenta],
  ], PAD, cursor + 16, 14);
  cursor += 28;

  const movers = [
    { sym: "AAOI", chg: "+56.88%", price: "$84.23", dir: 1, vol: 8.2 },
    { sym: "BWIN", chg: "+25.64%", price: "$23.23", dir: 1, vol: 4.5 },
    { sym: "RUN",  chg: "-35.11%", price: "$13.25", dir: -1, vol: 6.1 },
    { sym: "FIGR", chg: "-25.73%", price: "$25.28", dir: -1, vol: 2.3 },
  ];

  const maxVol = Math.max(...movers.map((m) => m.vol));
  for (const m of movers) {
    const col = m.dir >= 0 ? C.green : C.red;
    const arrow = m.dir >= 0 ? Ph.trendUp : Ph.trendDown;
    const volBar = toBlockBar(m.vol, maxVol, 8);
    drawColoredLine(ctx, [
      [arrow, col, "Ph Light"],
      [` ${m.sym.padEnd(5)}`, C.white],
      [`${m.chg.padStart(9)}`, col],
      [`  ${m.price}`, C.gray],
      ["  ", C.bg],
      [volBar, col],
    ], PAD + 8, cursor + 20, 20);
    cursor += 28;
  }
  cursor += 8;

  drawSep(ctx, cursor);
  cursor += 16;

  // ── News ──
  drawColoredLine(ctx, [
    [Ph.newspaper, C.orange, "Ph Light"],
    [" NEWS", C.orange],
  ], PAD, cursor + 16, 14);
  cursor += 28;

  const headlines = [
    "Trump Administration Shuns Anthropic...",
    "NVDA earnings beat expectations, guide...",
    "Fed signals patience on rate cuts amid...",
  ];
  for (const hl of headlines) {
    drawText(ctx, hl, PAD + 8, cursor + 16, C.orange, 16);
    cursor += 24;
  }
  cursor += 8;

  // ── Footer (pinned to bottom) ──
  drawSep(ctx, H - 38);
  drawColoredLine(ctx, [
    [Ph.timer, C.gray, "Ph Light"],
    [" Opens Mon 09:30", C.gray],
    ["  ", C.bg],
    ["54h 50m", C.white],
    ["  ", C.bg],
    [Ph.plugConnected, C.green, "Ph Light"],
    [" IBKR", C.green],
    ["  ", C.bg],
    ["Yahoo", C.gray],
  ], PAD, H - 14, 16);

  // ── Encode ──
  const pngBuf = canvas.toBuffer("image/png");
  const jpegBuf = await sharp(pngBuf).jpeg({ quality: 92 }).toBuffer();
  console.log(`Frame: ${jpegBuf.length} bytes (${(jpegBuf.length / 1024).toFixed(1)}KB)`);
  return jpegBuf;
}

// ─── Send to Device ─────────────────────────────────────────

async function sendCommand(command: string, payload: Record<string, unknown> = {}): Promise<any> {
  const body = { Command: command, ...payload };
  try {
    const response = await fetch(DEVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return response.json();
  } catch (err: any) {
    console.error(`  Device error: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log("Rendering full frame (max transparency, Phosphor icons)...");
  const jpeg = await renderFrame();

  // Save a local copy for preview
  const { writeFileSync } = await import("fs");
  const outPath = resolve(import.meta.dirname ?? ".", "../../data/fullframe-preview.jpg");
  writeFileSync(outPath, jpeg);
  console.log(`Preview saved: ${outPath}`);

  // Host JPEG on a temp HTTP server for the device to fetch
  const { createServer } = await import("http");
  const server = createServer((req, res) => {
    console.log(`  Device fetched: ${req.url}`);
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": jpeg.length });
    res.end(jpeg);
  });

  await new Promise<void>((resolve) => server.listen(9877, "0.0.0.0", resolve));
  console.log("Serving JPEG on http://0.0.0.0:9877/frame.jpg");

  // First clear DispList so text elements don't overlap
  const clear = await sendCommand("Device/EnterCustomControlMode", { DispList: [] });
  console.log("Clear DispList:", clear?.ReturnCode === 0 ? "OK" : clear);

  // Send background image
  const result = await sendCommand("Channel/SetCustomPageV2", {
    BackgroudImageAddr: "http://192.168.0.47:9877/frame.jpg",
  });
  console.log("SetCustomPageV2:", result?.ReturnCode === 0 ? "OK" : result);

  // Keep server alive for device to fetch
  console.log("Waiting 15s for device to fetch...");
  await new Promise((resolve) => setTimeout(resolve, 15000));
  server.close();
  console.log("Done! Check the glass.");
}

main().catch(console.error);
