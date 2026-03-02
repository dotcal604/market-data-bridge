/**
 * Glyph PoC: showcase all Unicode creative techniques on the glass panel
 *
 * Demonstrates: braille sparklines, block bars, box-drawing tables,
 * status dots, progress bars, Nerd Font extras — all on pure black canvas.
 *
 * Usage:
 *   npx tsx src/divoom/probe-glyphs.ts
 */

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import sharp from "sharp";
import { resolve } from "path";
import { writeFileSync } from "fs";

const W = 800;
const H = 1280;
const PAD = 24;

// ─── Register Fonts ─────────────────────────────────────────

const fontDir = resolve(import.meta.dirname ?? ".", "../../data/fonts");

GlobalFonts.registerFromPath(resolve(fontDir, "JetBrainsMono-Regular.ttf"), "JBMono");
GlobalFonts.registerFromPath(resolve(fontDir, "JetBrainsMono-Bold.ttf"), "JBMono Bold");
GlobalFonts.registerFromPath(resolve(fontDir, "JetBrainsMono-Medium.ttf"), "JBMono Medium");
GlobalFonts.registerFromPath(resolve(fontDir, "Phosphor-Light.ttf"), "Ph Light");
GlobalFonts.registerFromPath(resolve(fontDir, "Phosphor.ttf"), "Ph");

// Nerd Font — has powerline, weather, dev icons, 7000+ extra glyphs
GlobalFonts.registerFromPath(resolve(fontDir, "JetBrainsMonoNerdFont-Regular.ttf"), "JBNerd");
GlobalFonts.registerFromPath(resolve(fontDir, "JetBrainsMonoNerdFont-Bold.ttf"), "JBNerd Bold");

console.log("Fonts:", {
  JBMono: GlobalFonts.has("JBMono"),
  "Ph Light": GlobalFonts.has("Ph Light"),
  JBNerd: GlobalFonts.has("JBNerd"),
});

// ─── Colors ─────────────────────────────────────────────────

const C = {
  bg:        "#000000",
  green:     "#00DD55",
  red:       "#EE3322",
  cyan:      "#00CCEE",
  yellow:    "#EEDD00",
  orange:    "#FF9922",
  white:     "#FFFFFF",
  gray:      "#777777",
  dimGray:   "#333333",
  magenta:   "#FF44FF",
  softWhite: "#CCCCCC",
};

// ─── Phosphor Codepoints ────────────────────────────────────

const Ph = {
  chartLineUp: "\uE156", trendUp:   "\uE4AE", trendDown:    "\uE4AC",
  lightning:   "\uE2DE", clock:     "\uE19A", timer:        "\uE492",
  dollar:      "\uE550", shield:    "\uE40A", fire:         "\uE242",
  newspaper:   "\uE344", broadcast: "\uE0F2", plugConnected:"\uEB5A",
  gauge:       "\uE628", warning:   "\uE4E0", eye:          "\uE220",
};

// ─── Nerd Font Codepoints (sample) ──────────────────────────

const Nf = {
  // Powerline
  rightArrow:   "\uE0B0",  //
  rightSoft:    "\uE0B1",  //
  leftArrow:    "\uE0B2",  //
  leftSoft:     "\uE0B3",  //
  // Weather (from Nerd Fonts weather subset)
  daySunny:     "\uE30D",  //
  cloud:        "\uE312",  //
  thermometer:  "\uE350",  //
  // Dev icons
  git:          "\uE702",  //
  nodejs:       "\uE718",  //
  python:       "\uE73C",  //
  docker:       "\uE7B0",  //
  // OS
  apple:        "\uE711",  //
  linux:        "\uE712",  //
  windows:      "\uE70F",  //
  // Misc
  flame:        "\uF490",  //
  database:     "\uF1C0",  //
  server:       "\uF233",  //
  wifi:         "\uF1EB",  //
  lock:         "\uF023",  //
  check:        "\uF00C",  //
  times:        "\uF00D",  //
  bolt:         "\uF0E7",  //
};

// ─── Drawing Helpers ────────────────────────────────────────

type Segment = [string, string, string?]; // [text, color, font?]

function drawColoredLine(
  ctx: CanvasRenderingContext2D,
  segments: Segment[],
  x: number, y: number, size: number, defaultFont = "JBMono",
) {
  let curX = x;
  for (const [text, color, font] of segments) {
    ctx.font = `${size}px '${font ?? defaultFont}'`;
    ctx.fillStyle = color;
    ctx.fillText(text, curX, y);
    curX += ctx.measureText(text).width;
  }
  return curX; // return end X for chaining
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string, x: number, y: number,
  color: string, size: number, font = "JBMono",
) {
  ctx.font = `${size}px '${font}'`;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawSep(ctx: CanvasRenderingContext2D, y: number, style: "thin" | "dotted" | "box" = "thin") {
  if (style === "thin") {
    ctx.strokeStyle = C.dimGray;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
  } else if (style === "dotted") {
    ctx.fillStyle = C.dimGray;
    for (let x = PAD; x < W - PAD; x += 8) {
      ctx.fillRect(x, y, 2, 1);
    }
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, label: string, y: number, color: string) {
  drawText(ctx, label, PAD, y, color, 13, "JBMono Bold");
}

// ─── Braille Sparkline Generator ────────────────────────────
// Each braille char = 2 data points (left + right column)
// 4 vertical dot positions per column (8 dots total per char)

function toBraille(data: number[]): string {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Normalize to 0-3 (4 vertical positions, 0=bottom 3=top)
  const norm = data.map(v => Math.round(((v - min) / range) * 3));

  // Dot bit positions (bottom-to-top order):
  // Left column:  dot7=64, dot3=4, dot2=2, dot1=1
  // Right column: dot8=128, dot6=32, dot5=16, dot4=8
  const leftBits  = [64, 4, 2, 1];
  const rightBits = [128, 32, 16, 8];

  let result = "";
  for (let i = 0; i < norm.length; i += 2) {
    let code = 0;
    // Left column — set dot at the height
    const lh = norm[i];
    code |= leftBits[3 - lh]; // invert: 3=top dot, 0=bottom dot
    // Right column
    if (i + 1 < norm.length) {
      const rh = norm[i + 1];
      code |= rightBits[3 - rh];
    }
    result += String.fromCharCode(0x2800 + code);
  }
  return result;
}

// Filled braille — fills from bottom up to data height
function toBrailleFilled(data: number[]): string {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const norm = data.map(v => Math.round(((v - min) / range) * 3));

  const leftBits  = [64, 4, 2, 1];   // bottom to top
  const rightBits = [128, 32, 16, 8];

  let result = "";
  for (let i = 0; i < norm.length; i += 2) {
    let code = 0;
    // Left — fill from bottom up to height
    for (let h = 0; h <= norm[i]; h++) code |= leftBits[h];
    // Right
    if (i + 1 < norm.length) {
      for (let h = 0; h <= norm[i + 1]; h++) code |= rightBits[h];
    }
    result += String.fromCharCode(0x2800 + code);
  }
  return result;
}

// ─── Block Bar Helpers ──────────────────────────────────────

const BLOCK_CHARS = " ▁▂▃▄▅▆▇█";  // 9 levels (0-8)

function toBlockBar(value: number, max: number, width: number): string {
  const filled = Math.round((value / max) * width * 8);
  const fullBlocks = Math.floor(filled / 8);
  const partial = filled % 8;
  return "█".repeat(fullBlocks) +
    (partial > 0 ? BLOCK_CHARS[partial] : "") +
    "░".repeat(Math.max(0, width - fullBlocks - (partial > 0 ? 1 : 0)));
}

function toVerticalBars(data: number[]): string {
  const max = Math.max(...data);
  return data.map(v => {
    const level = Math.round((v / max) * 8);
    return BLOCK_CHARS[level];
  }).join("");
}

// ─── Progress Bar ───────────────────────────────────────────

function toProgressBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ─── Main Render ────────────────────────────────────────────

async function renderFrame(): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  let y = PAD;

  // ════════════════════════════════════════════════════════════
  // SECTION 1: Header with status dots + Nerd Font powerline
  // ════════════════════════════════════════════════════════════
  drawLabel(ctx, "── STATUS DOTS + NERD FONT POWERLINE ──", y + 16, C.dimGray);
  y += 32;

  // Status dots: ● = connected, ○ = disconnected, ◐ = partial
  drawColoredLine(ctx, [
    ["●", C.green],  [" IBKR ", C.gray],
    ["●", C.green],  [" Yahoo ", C.gray],
    ["○", C.red],    [" Schwab ", C.gray],
    ["◐", C.yellow], [" Delayed", C.gray],
  ], PAD, y + 24, 22);
  y += 36;

  // Nerd Font powerline separators
  drawColoredLine(ctx, [
    [" CLOSED ", C.white, "JBNerd Bold"],
    [Nf.rightArrow, C.orange, "JBNerd"],
    [" 02:45 ET ", C.softWhite, "JBNerd"],
    [Nf.rightArrow, C.gray, "JBNerd"],
    [" ", C.bg],
    [Nf.wifi, C.green, "JBNerd"],
    [" ", C.bg],
    [Nf.lock, C.green, "JBNerd"],
    [" ", C.bg],
    [Nf.server, C.cyan, "JBNerd"],
  ], PAD, y + 24, 22);
  y += 36;

  // Nerd Font dev/platform icons showcase
  drawColoredLine(ctx, [
    [Nf.nodejs, C.green, "JBNerd"],   [" ", C.bg],
    [Nf.python, C.cyan, "JBNerd"],    [" ", C.bg],
    [Nf.docker, C.cyan, "JBNerd"],    [" ", C.bg],
    [Nf.git, C.orange, "JBNerd"],     [" ", C.bg],
    [Nf.database, C.magenta, "JBNerd"], [" ", C.bg],
    [Nf.windows, C.cyan, "JBNerd"],   [" ", C.bg],
    [Nf.apple, C.softWhite, "JBNerd"], [" ", C.bg],
    [Nf.linux, C.yellow, "JBNerd"],   [" ", C.bg],
    [Nf.bolt, C.yellow, "JBNerd"],    [" ", C.bg],
    [Nf.flame, C.red, "JBNerd"],      [" ", C.bg],
    [Nf.check, C.green, "JBNerd"],    [" ", C.bg],
    [Nf.times, C.red, "JBNerd"],
  ], PAD, y + 24, 24);
  y += 40;

  drawSep(ctx, y);
  y += 16;

  // ════════════════════════════════════════════════════════════
  // SECTION 2: Indices with inline braille sparklines
  // ════════════════════════════════════════════════════════════
  drawLabel(ctx, "── BRAILLE SPARKLINES (inline) ──", y + 16, C.dimGray);
  y += 32;

  const indicesData = [
    { sym: "SPY", val: "580.25", chg: "-0.48%", dir: -1,
      spark: [82,84,81,85,88,86,90,92,89,87,91,94,96,93,95,98,97,99,101,100] },
    { sym: "QQQ", val: "495.12", chg: "-0.32%", dir: -1,
      spark: [70,72,69,74,77,75,73,78,80,82,79,81,84,83,85,88,86,87,90,89] },
    { sym: "DIA", val: "425.88", chg: "-1.05%", dir: -1,
      spark: [50,48,52,49,46,48,45,47,44,43,45,42,44,41,43,40,42,39,41,38] },
    { sym: "VIX", val: " 20.1", chg: "+6.6%",  dir: 1,
      spark: [14,13,15,16,14,18,20,17,19,22,21,24,23,25,22,20,18,19,21,20] },
  ];

  for (const idx of indicesData) {
    const col = idx.dir >= 0 ? C.green : C.red;
    const arrow = idx.dir >= 0 ? Ph.trendUp : Ph.trendDown;
    const braille = toBrailleFilled(idx.spark);
    drawColoredLine(ctx, [
      [idx.sym, C.cyan],
      [` ${idx.val} `, C.white],
      [braille, col],     // ← braille sparkline inline!
      [" ", C.bg],
      [arrow, col, "Ph Light"],
      [` ${idx.chg}`, col],
    ], PAD, y + 22, 22);
    y += 30;
  }
  y += 8;

  // Also show the dot-style (unfilled) braille for comparison
  drawText(ctx, "dot-style:  " + toBraille(indicesData[0].spark), PAD, y + 16, C.gray, 16);
  drawText(ctx, "filled:     " + toBrailleFilled(indicesData[0].spark), PAD, y + 34, C.cyan, 16);
  y += 48;

  drawSep(ctx, y);
  y += 16;

  // ════════════════════════════════════════════════════════════
  // SECTION 3: Sector strength with block bars
  // ════════════════════════════════════════════════════════════
  drawLabel(ctx, "── BLOCK ELEMENT BARS ──", y + 16, C.dimGray);
  y += 32;

  const sectors = [
    { name: "TECH ", val: 85, chg: "+1.2%", dir: 1 },
    { name: "HLTH ", val: 62, chg: "+0.6%", dir: 1 },
    { name: "FINL ", val: 45, chg: "+0.2%", dir: 1 },
    { name: "ENER ", val: 30, chg: "-0.8%", dir: -1 },
    { name: "UTIL ", val: 15, chg: "-1.5%", dir: -1 },
  ];

  for (const s of sectors) {
    const col = s.dir >= 0 ? C.green : C.red;
    const bar = toBlockBar(s.val, 100, 12);
    drawColoredLine(ctx, [
      [s.name, C.softWhite],
      [bar, col],
      [` ${s.chg}`, col],
    ], PAD, y + 20, 20);
    y += 28;
  }
  y += 4;

  // Vertical bars (like a tiny bar chart)
  const volumeData = [3, 5, 8, 12, 7, 15, 20, 18, 14, 10, 6, 4, 9, 16, 22, 19, 11, 8, 5, 13];
  drawColoredLine(ctx, [
    ["VOL ", C.gray],
    [toVerticalBars(volumeData), C.cyan],
    [" ← vertical bars", C.dimGray],
  ], PAD, y + 20, 20);
  y += 32;

  drawSep(ctx, y);
  y += 16;

  // ════════════════════════════════════════════════════════════
  // SECTION 4: Positions in box-drawing table
  // ════════════════════════════════════════════════════════════
  drawLabel(ctx, "── BOX DRAWING TABLE ──", y + 16, C.dimGray);
  y += 32;

  const boxFont = 18;
  // Table header
  drawText(ctx, "┌────────┬───────┬─────────┬───────────┐", PAD, y + 18, C.dimGray, boxFont);
  y += 24;
  drawColoredLine(ctx, [
    ["│ ", C.dimGray], ["SYMBOL", C.gray], ["  │ ", C.dimGray],
    ["QTY", C.gray], ["   │ ", C.dimGray],
    ["  P&L", C.gray], ["    │ ", C.dimGray],
    ["STOP", C.gray], ["      │", C.dimGray],
  ], PAD, y + 18, boxFont);
  y += 24;
  drawText(ctx, "├────────┼───────┼─────────┼───────────┤", PAD, y + 18, C.dimGray, boxFont);
  y += 24;

  const tableRows = [
    { sym: "PLTR", qty: " 45", pnl: " +$142", pnlDir: 1, stop: "stp $82.5" },
    { sym: "NVDA", qty: " 20", pnl: "  -$38", pnlDir: -1, stop: "stp $410 " },
    { sym: "AAPL", qty: " 15", pnl: "  +$21", pnlDir: 1, stop: "   none  " },
  ];

  for (const row of tableRows) {
    const pnlCol = row.pnlDir >= 0 ? C.green : C.red;
    const stopCol = row.stop.includes("none") ? C.orange : C.gray;
    drawColoredLine(ctx, [
      ["│ ", C.dimGray], [row.sym, C.white], ["    │ ", C.dimGray],
      [row.qty, C.softWhite], ["   │ ", C.dimGray],
      [row.pnl, pnlCol], ["   │ ", C.dimGray],
      [row.stop, stopCol], [" │", C.dimGray],
    ], PAD, y + 18, boxFont);
    y += 24;
  }
  drawText(ctx, "└────────┴───────┴─────────┴───────────┘", PAD, y + 18, C.dimGray, boxFont);
  y += 32;

  drawSep(ctx, y);
  y += 16;

  // ════════════════════════════════════════════════════════════
  // SECTION 5: P&L with block progress bar
  // ════════════════════════════════════════════════════════════
  drawLabel(ctx, "── PROGRESS BAR (block elements) ──", y + 16, C.dimGray);
  y += 32;

  // Day P&L with progress bar for deployed %
  drawColoredLine(ctx, [
    [Ph.dollar, C.green, "Ph Light"],
    [" Day ", C.gray],
    ["+$342", C.green, "JBMono Bold"],
    ["    Net ", C.gray],
    ["$24.1K", C.white, "JBMono Bold"],
  ], PAD, y + 26, 26);
  y += 40;

  // Deployed % as progress bar
  const deployedPct = 73;
  const bar = toProgressBar(deployedPct, 20);
  drawColoredLine(ctx, [
    [Ph.gauge, C.cyan, "Ph Light"],
    [" Deployed [", C.gray],
    [bar, C.cyan],
    ["] ", C.gray],
    [`${deployedPct}%`, C.white, "JBMono Bold"],
  ], PAD, y + 22, 20);
  y += 32;

  // Risk heat bar (gradient visualization using block density)
  drawColoredLine(ctx, [
    [Ph.warning, C.orange, "Ph Light"],
    [" Risk     [", C.gray],
    ["████", C.green],
    ["████", C.yellow],
    ["██", C.orange],
    ["░░░░░░░░░░", C.dimGray],
    ["] ", C.gray],
    ["MED", C.yellow, "JBMono Bold"],
  ], PAD, y + 22, 20);
  y += 40;

  drawSep(ctx, y);
  y += 16;

  // ════════════════════════════════════════════════════════════
  // SECTION 6: Movers with volume intensity
  // ════════════════════════════════════════════════════════════
  drawLabel(ctx, "── MOVERS + VOLUME INTENSITY ──", y + 16, C.dimGray);
  y += 32;

  const movers = [
    { sym: "AAOI", chg: "+56.88%", price: "$84.23", dir: 1, vol: 95 },
    { sym: "BWIN", chg: "+25.64%", price: "$23.23", dir: 1, vol: 72 },
    { sym: "RUN",  chg: "-35.11%", price: "$13.25", dir: -1, vol: 88 },
    { sym: "FIGR", chg: "-25.73%", price: "$25.28", dir: -1, vol: 45 },
  ];

  for (const m of movers) {
    const col = m.dir >= 0 ? C.green : C.red;
    const arrow = m.dir >= 0 ? Ph.trendUp : Ph.trendDown;
    const volBar = toBlockBar(m.vol, 100, 6);
    drawColoredLine(ctx, [
      [arrow, col, "Ph Light"],
      [` ${m.sym.padEnd(5)}`, C.white],
      [`${m.chg.padEnd(9)}`, col],
      [` ${m.price}`, C.gray],
      ["  ", C.bg],
      [volBar, C.cyan],
    ], PAD, y + 20, 20);
    y += 28;
  }
  y += 8;

  drawSep(ctx, y);
  y += 16;

  // ════════════════════════════════════════════════════════════
  // SECTION 7: Mixed creativity — decorative elements
  // ════════════════════════════════════════════════════════════
  drawLabel(ctx, "── DECORATIVE UNICODE ──", y + 16, C.dimGray);
  y += 32;

  // Diamond/star separators
  drawText(ctx, "✦ ─── ✧ ─── ✦ ─── ✧ ─── ✦ ─── ✧ ─── ✦", PAD, y + 18, C.dimGray, 18);
  y += 28;

  // Circles as rating/score indicators
  drawColoredLine(ctx, [
    ["Score: ", C.gray],
    ["●", C.green], ["●", C.green], ["●", C.green], ["●", C.green],
    ["○", C.dimGray],
    [" 4/5  ", C.softWhite],
    ["Conf: ", C.gray],
    ["◉", C.cyan], ["◉", C.cyan], ["◉", C.cyan],
    ["◎", C.dimGray], ["◎", C.dimGray],
    [" 3/5", C.softWhite],
  ], PAD, y + 20, 20);
  y += 32;

  // Arrows as trend matrix
  drawColoredLine(ctx, [
    ["1D ", C.gray], ["↗", C.green], ["  ", C.bg],
    ["1W ", C.gray], ["→", C.yellow], ["  ", C.bg],
    ["1M ", C.gray], ["↘", C.red], ["  ", C.bg],
    ["3M ", C.gray], ["↗", C.green], ["  ", C.bg],
    ["YTD ", C.gray], ["↑", C.green],
  ], PAD, y + 20, 22);
  y += 36;

  // Block element gradient
  drawText(ctx, "░░░▒▒▒▓▓▓███████▓▓▓▒▒▒░░░", PAD, y + 20, C.cyan, 20);
  drawText(ctx, "← density gradient →", PAD + 420, y + 20, C.dimGray, 14);
  y += 32;

  // Braille art — a small wave pattern
  drawText(ctx, "⠀⠀⣠⣤⣶⣿⣿⣿⣶⣤⣀⠀⠀⠀⠀⠀⣀⣤⣶⣿⣿⣿⣶⣤⣄⠀⠀", PAD, y + 20, C.magenta, 20);
  drawText(ctx, "← braille density art →", PAD + 420, y + 20, C.dimGray, 14);
  y += 36;

  // ════════════════════════════════════════════════════════════
  // FOOTER
  // ════════════════════════════════════════════════════════════
  drawSep(ctx, H - 44, "dotted");
  drawColoredLine(ctx, [
    ["●", C.green], [" Live ", C.gray],
    ["│", C.dimGray],
    [" JBMono ", C.softWhite],
    ["│", C.dimGray],
    [" Phosphor ", C.softWhite],
    ["│", C.dimGray],
    [" Nerd Font ", C.softWhite],
    ["│", C.dimGray],
    [" Unicode ", C.softWhite],
    ["│", C.dimGray],
    [" Braille", C.softWhite],
  ], PAD, H - 18, 16);

  // ── Encode ──
  const pngBuf = canvas.toBuffer("image/png");
  const jpegBuf = await sharp(pngBuf).jpeg({ quality: 92 }).toBuffer();
  return jpegBuf;
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  console.log("Rendering glyph PoC (all techniques)...");
  const jpeg = await renderFrame();

  const outPath = resolve(import.meta.dirname ?? ".", "../../data/glyphs-preview.jpg");
  writeFileSync(outPath, jpeg);
  console.log(`Preview: ${outPath} (${(jpeg.length / 1024).toFixed(1)}KB)`);
}

main().catch(console.error);
