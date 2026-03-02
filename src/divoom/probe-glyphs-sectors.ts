/**
 * Probe Phosphor Light font for sector-appropriate icons.
 * Renders candidate codepoints at large size so we can pick the best ones.
 *
 * Usage: npx tsx src/divoom/probe-glyphs-sectors.ts
 */

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontDir = resolve(__dirname, "../../data/fonts");

// Register Phosphor Light
GlobalFonts.registerFromPath(resolve(fontDir, "Phosphor-Light.ttf"), "Ph Light");

// CORRECT codepoints from @phosphor-icons/core package metadata
const CANDIDATES: Record<string, [string, number][]> = {
  "TECH": [
    ["cpu", 0xE610],
    ["desktop", 0xE560],
    ["circuitry", 0xE9C2],
    ["monitor", 0xE32E],
    ["laptop", 0xE586],
    ["desktopTower", 0xE562],
    ["gear", 0xE270],
  ],
  "HLTH": [
    ["heart", 0xE2A8],
    ["heartbeat", 0xE2AC],
    ["firstAid", 0xE56E],
    ["firstAidKit", 0xE570],
    ["pill", 0xE700],
    ["stethoscope", 0xE7EA],
    ["hospital", 0xE844],
  ],
  "FINL": [
    ["currDollar", 0xE550],
    ["bank", 0xE0B4],
    ["wallet", 0xE68A],
    ["chartLineUp", 0xE156],
    ["coins", 0xE78E],
    ["money", 0xE588],
    ["vault", 0xE76E],
  ],
  "INDU": [
    ["factory", 0xE760],
    ["gearSix", 0xE272],
    ["gear", 0xE270],
    ["wrench", 0xE5D4],
    ["hammer", 0xE80E],
    ["hardHat", 0xED46],
    ["buildings", 0xE102],
  ],
  "CONS": [
    ["shoppingCart", 0xE41E],
    ["storefront", 0xE470],
    ["bag", 0xE0B0],
    ["shoppingBag", 0xE416],
    ["basket", 0xE964],
    ["coffee", 0xE1C2],
    ["diamond", 0xE1EC],
  ],
  "ENER": [
    ["lightning", 0xE2DE],
    ["gasCan", 0xE8CE],
    ["flame", 0xE624],
    ["fire", 0xE242],
    ["batteryFull", 0xE0C0],
    ["plug", 0xE946],
    ["sun", 0xE472],
  ],
  "UTIL": [
    ["lightbulb", 0xE2DC],
    ["drop", 0xE210],
    ["plugsConnected", 0xEB5A],
    ["plug", 0xE946],
    ["power", 0xE3DA],
    ["lightning", 0xE2DE],
    ["sun", 0xE472],
  ],
  "REAL": [
    ["house", 0xE2C2],
    ["houseSimple", 0xE2C6],
    ["buildingApt", 0xE0FE],
    ["building", 0xE100],
    ["buildings", 0xE102],
    ["key", 0xE2D6],
    ["mapPin", 0xE316],
  ],
  "MATL": [
    ["atom", 0xE5E4],
    ["cube", 0xE1DA],
    ["diamond", 0xE1EC],
    ["mountains", 0xE7AE],
    ["tree", 0xE6DA],
    ["leaf", 0xE2DA],
    ["hammer", 0xE80E],
  ],
  "COMM": [
    ["broadcast", 0xE0F2],
    ["chatCircle", 0xE168],
    ["wifiHigh", 0xE4EA],
    ["phone", 0xE3B8],
    ["envelope", 0xE214],
    ["globe", 0xE288],
    ["monitor", 0xE32E],
  ],
  "STPL": [
    ["shield", 0xE40A],
    ["basket", 0xE964],
    ["cookie", 0xE6CA],
    ["coffee", 0xE1C2],
    ["forkKnife", 0xE262],
    ["wine", 0xE6B2],
    ["shoppingCart", 0xE41E],
  ],
};

const SECTORS = Object.keys(CANDIDATES);
const ITEMS_PER_ROW = 7;
const CELL_W = 100;
const CELL_H = 90;
const LABEL_H = 20;
const canvasW = CELL_W * ITEMS_PER_ROW + 40;
const canvasH = (CELL_H + LABEL_H) * SECTORS.length + 60;

const canvas = createCanvas(canvasW, canvasH);
const ctx = canvas.getContext("2d");

// Background
ctx.fillStyle = "#1A1A1A";
ctx.fillRect(0, 0, canvasW, canvasH);

let row = 0;
for (const sector of SECTORS) {
  const items = CANDIDATES[sector];
  const baseY = 40 + row * (CELL_H + LABEL_H);

  // Sector label
  ctx.font = "14px 'Ph Light'";
  ctx.fillStyle = "#888888";
  // Use a basic font for the label since we want readable text
  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = "#CCCCCC";
  ctx.fillText(sector, 10, baseY - 6);

  for (let i = 0; i < items.length; i++) {
    const [name, cp] = items[i];
    const x = 20 + i * CELL_W;

    // Draw the glyph large
    const glyph = String.fromCodePoint(cp);
    ctx.font = "40px 'Ph Light'";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(glyph, x + 30, baseY + 46);

    // Label underneath
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#888888";
    ctx.fillText(`${name}`, x + 5, baseY + 68);
    ctx.fillText(`U+${cp.toString(16).toUpperCase()}`, x + 5, baseY + 80);
  }

  row++;
}

const buf = canvas.toBuffer("image/png");
writeFileSync(resolve(__dirname, "../../data/sector-glyphs.png"), buf);
console.log(`Wrote data/sector-glyphs.png (${canvasW}×${canvasH})`);
