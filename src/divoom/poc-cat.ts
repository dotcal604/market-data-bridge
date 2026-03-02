/**
 * PoC: Arbitrary image compositing on Divoom TimesFrame
 *
 * Fetches a random cat image, composites it onto the 800×1280 canvas
 * with a semi-transparent glass overlay + Lato text, pushes to device.
 *
 * Usage: npx tsx src/divoom/poc-cat.ts
 */

import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import sharp from "sharp";
import { resolve } from "path";
import http from "http";

const DEVICE = "http://192.168.0.48:9000/divoom_api";
const LAN_IP = "192.168.0.47";
const PORT = 9877;
const W = 800;
const H = 1280;

// ── Register fonts ───────────────────────────────────────────
const fontDir = resolve(import.meta.dirname ?? ".", "../../data/fonts");
GlobalFonts.registerFromPath(resolve(fontDir, "Lato.ttf"), "Lato");
GlobalFonts.registerFromPath(resolve(fontDir, "Lato-Bold.ttf"), "Lato Bold");
GlobalFonts.registerFromPath(resolve(fontDir, "Lato-Semibold.ttf"), "Lato Semibold");

// ── Fetch cat image ──────────────────────────────────────────
console.log("Fetching cat image...");
const catResp = await fetch("https://cataas.com/cat?width=800&height=800");
const catBuf = Buffer.from(await catResp.arrayBuffer());
const catImg = await loadImage(catBuf);
console.log(`  Got ${catImg.width}×${catImg.height} cat`);

// ── Compose onto canvas ──────────────────────────────────────
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

// Black background (transparent glass on TimesFrame)
ctx.fillStyle = "#000000";
ctx.fillRect(0, 0, W, H);

// Draw cat image — scale to fill width, center vertically
const scale = W / catImg.width;
const drawH = catImg.height * scale;
const drawY = (H - drawH) / 2;
ctx.drawImage(catImg as any, 0, drawY, W, drawH);

// Semi-transparent dark overlay at top (for text readability)
const grad = ctx.createLinearGradient(0, 0, 0, 200);
grad.addColorStop(0, "rgba(0,0,0,0.85)");
grad.addColorStop(1, "rgba(0,0,0,0)");
ctx.fillStyle = grad;
ctx.fillRect(0, 0, W, 200);

// Same at bottom
const grad2 = ctx.createLinearGradient(0, H - 200, 0, H);
grad2.addColorStop(0, "rgba(0,0,0,0)");
grad2.addColorStop(1, "rgba(0,0,0,0.85)");
ctx.fillStyle = grad2;
ctx.fillRect(0, H - 200, W, 200);

// Header text
ctx.font = "28px 'Lato Bold'";
ctx.fillStyle = "#00CC44";
ctx.fillText("● LIVE", 24, 50);

ctx.font = "28px 'Lato'";
ctx.fillStyle = "#AAAAAA";
ctx.fillText("MARKET DATA BRIDGE", 140, 50);

// Cat label
ctx.font = "48px 'Lato Bold'";
ctx.fillStyle = "#FFFFFF";
ctx.textAlign = "center";
ctx.fillText("GRUMPY CAT", W / 2, H - 120);

ctx.font = "24px 'Lato'";
ctx.fillStyle = "#00BBDD";
ctx.fillText("Arbitrary image compositing — PoC", W / 2, H - 80);

ctx.font = "18px 'Lato'";
ctx.fillStyle = "#666666";
ctx.fillText("BackgroudImageAddr + @napi-rs/canvas", W / 2, H - 50);

// ── Encode to JPEG ───────────────────────────────────────────
const pngBuf = canvas.toBuffer("image/png");
const jpeg = await sharp(pngBuf).jpeg({ quality: 90 }).toBuffer();
console.log(`  Canvas: ${W}×${H} → ${(jpeg.length / 1024).toFixed(1)} KB JPEG`);

// ── Serve the JPEG (device fetches from us) ──────────────────
let fetched = false;
const srv = http.createServer((req, res) => {
  console.log(`  📥 Device fetched: ${req.method} ${req.url}`);
  fetched = true;
  res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": jpeg.length });
  res.end(jpeg);
});

srv.listen(PORT, "0.0.0.0");
await new Promise<void>((resolve) => srv.on("listening", resolve));
console.log(`  Serving at http://${LAN_IP}:${PORT}/frame.jpg`);

// ── Push to device via low-level http.request (more reliable) ─
const bgUrl = `http://${LAN_IP}:${PORT}/frame.jpg?t=${Date.now()}`;
const payload = JSON.stringify({
  Command: "Device/EnterCustomControlMode",
  DispList: [{
    ID: 1, Type: "Text",
    StartX: 0, StartY: 0, Width: 1, Height: 1,
    Align: 0, FontSize: 1, FontID: 52,
    FontColor: "#000000", BgColor: "#000000",
    TextMessage: " ",
  }],
  BackgroudImageAddr: bgUrl,
});

console.log("Pushing to device...");
const t0 = performance.now();

// Use http.request instead of fetch — more reliable with the device
const pushResult = await new Promise<string>((resolve) => {
  const req = http.request(
    "http://192.168.0.48:9000/divoom_api",
    { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }, timeout: 10000 },
    (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body));
    },
  );
  req.on("error", (e) => resolve(`ERROR: ${e.message}`));
  req.on("timeout", () => { req.destroy(); resolve("TIMEOUT"); });
  req.end(payload);
});

const ms = performance.now() - t0;
console.log(`  Device responded in ${ms.toFixed(0)}ms → ${pushResult}`);

// ── Wait for device to fetch our JPEG ─────────────────────────
// The device fetches asynchronously after accepting the command.
// Wait up to 15s, checking every second.
console.log("  Waiting for device to fetch JPEG...");
for (let i = 0; i < 15; i++) {
  if (fetched) break;
  await new Promise((r) => setTimeout(r, 1000));
  if (!fetched) process.stdout.write(".");
}
console.log();

if (fetched) {
  console.log("✅ Done! Cat should be on the panel. 🐱");
} else {
  console.log("⚠️  Device didn't fetch the image within 15s.");
  console.log("    The command may not have reached it. Try again?");
}

srv.close();
process.exit(0);
