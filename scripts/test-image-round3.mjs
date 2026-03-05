#!/usr/bin/env node
/**
 * Diagnostic Round 3: Test PNG file data and URL format variations.
 *
 * Hypothesis A: PicData expects PNG/JPEG file bytes, not raw RGB pixels.
 * Hypothesis B: Image Url only works with HTTPS or port 80 URLs.
 * Hypothesis C: Device/PlayTFGif needs PicHeight or different format.
 * Hypothesis D: Need to reset GIF state before sending.
 * Hypothesis E: Device/PlayTFGif expects RGBA (4 bytes/pixel) not RGB.
 *
 * Usage: node scripts/test-image-round3.mjs [test-number]
 */

import { createCanvas } from "@napi-rs/canvas";

const DEVICE_IP = "192.168.0.48";
const DEVICE_PORT = 9000;
const DEVICE_URL = `http://${DEVICE_IP}:${DEVICE_PORT}/divoom_api`;

async function sendCommand(command, payload = {}) {
  const body = { Command: command, ...payload };
  const payloadStr = JSON.stringify(body);
  console.log(`\n→ Sending: ${command}`);
  console.log(`  Payload size: ${(payloadStr.length / 1024).toFixed(1)}KB`);

  try {
    const res = await fetch(DEVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payloadStr,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    console.log(`  ← ${JSON.stringify(data)}`);
    return data;
  } catch (err) {
    console.error(`  ✗ Error: ${err.message}`);
    return null;
  }
}

// ─── Generate test images ────────────────────────

/** Create a test PNG using @napi-rs/canvas (same library we use for charts) */
function makeTestPng(width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Dark background
  ctx.fillStyle = "#0A0A0A";
  ctx.fillRect(0, 0, width, height);

  // Red rectangle in center
  ctx.fillStyle = "#FF0000";
  ctx.fillRect(width * 0.1, height * 0.1, width * 0.8, height * 0.3);

  // Green rectangle below
  ctx.fillStyle = "#00FF00";
  ctx.fillRect(width * 0.1, height * 0.5, width * 0.8, height * 0.3);

  // White text
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold ${Math.floor(height * 0.06)}px sans-serif`;
  ctx.fillText("IMAGE TEST", width * 0.1, height * 0.45);

  return canvas.toBuffer("image/png");
}

/** Make raw RGB pixel data */
function makeRgbPixels(width, height, r, g, b) {
  const buf = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    buf[i * 3] = r;
    buf[i * 3 + 1] = g;
    buf[i * 3 + 2] = b;
  }
  return buf;
}

/** Make raw RGBA pixel data */
function makeRgbaPixels(width, height, r, g, b, a = 255) {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = a;
  }
  return buf;
}

// ─── Test Cases ──────────────────────────────────

/** Test 1: Device/PlayTFGif with PNG file data (not raw pixels) */
async function test1_playTfGif_png() {
  console.log("\n═══ TEST 1: Device/PlayTFGif with PNG file bytes ═══");
  const png = makeTestPng(800, 1280);
  console.log(`  PNG size: ${(png.length / 1024).toFixed(1)}KB`);

  await sendCommand("Device/PlayTFGif", {
    PicNum: 1,
    PicWidth: 800,
    PicHeight: 1280,
    PicOffset: 0,
    PicID: 1,
    PicSpeed: 1000,
    PicData: png.toString("base64"),
  });
  console.log("  → Expected: Red + green bars with white text");
}

/** Test 2: Device/PlayTFGif with RGBA pixels (4 bytes/pixel) */
async function test2_playTfGif_rgba() {
  console.log("\n═══ TEST 2: Device/PlayTFGif with RGBA pixels ═══");
  const rgba = makeRgbaPixels(800, 1280, 255, 0, 0, 255);
  console.log(`  RGBA size: ${(rgba.length / 1024).toFixed(1)}KB`);

  await sendCommand("Device/PlayTFGif", {
    PicNum: 1,
    PicWidth: 800,
    PicHeight: 1280,
    PicOffset: 0,
    PicID: 1,
    PicSpeed: 1000,
    PicData: rgba.toString("base64"),
  });
  console.log("  → Expected: Solid red screen");
}

/** Test 3: Draw/ResetHttpGifId then Device/PlayTFGif */
async function test3_resetThenPlay() {
  console.log("\n═══ TEST 3: Reset GIF ID then PlayTFGif ═══");
  await sendCommand("Draw/ResetHttpGifId");
  await new Promise(r => setTimeout(r, 1000));

  const rgb = makeRgbPixels(800, 1280, 0, 0, 255);
  await sendCommand("Device/PlayTFGif", {
    PicNum: 1,
    PicWidth: 800,
    PicHeight: 1280,
    PicOffset: 0,
    PicID: 1,
    PicSpeed: 1000,
    PicData: rgb.toString("base64"),
  });
  console.log("  → Expected: Solid blue screen");
}

/** Test 4: Image element with public HTTPS URL */
async function test4_httpsUrl() {
  console.log("\n═══ TEST 4: Image Url with HTTPS (public) ═══");
  // Small public PNG (picsum.photos returns actual image)
  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: "",
    DispList: [
      {
        ID: 1, Type: "Text",
        StartX: 16, StartY: 50, Width: 768, Height: 44,
        Align: 0, FontSize: 36, FontID: 52,
        FontColor: "#00FF00", BgColor: "#00000000",
        TextMessage: "TEST 4: HTTPS URL",
      },
      {
        ID: 2, Type: "Image",
        StartX: 16, StartY: 120, Width: 400, Height: 300,
        Align: 0, FontSize: 0, FontID: 0,
        FontColor: "#FFFFFF", BgColor: "#00000000",
        Url: "https://picsum.photos/400/300.jpg",
        ImgLocalFlag: 0,
      },
    ],
  });
  console.log("  → Expected: Green text + photo (if HTTPS works)");
}

/** Test 5: Image element with PNG data in PicData */
async function test5_imageElement_pngData() {
  console.log("\n═══ TEST 5: Image element with PNG in PicData ═══");
  const png = makeTestPng(400, 300);
  console.log(`  PNG size: ${(png.length / 1024).toFixed(1)}KB`);

  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: "",
    DispList: [
      {
        ID: 1, Type: "Text",
        StartX: 16, StartY: 50, Width: 768, Height: 44,
        Align: 0, FontSize: 36, FontID: 52,
        FontColor: "#FFFF00", BgColor: "#00000000",
        TextMessage: "TEST 5: PNG DATA",
      },
      {
        ID: 2, Type: "Image",
        StartX: 16, StartY: 120, Width: 400, Height: 300,
        Align: 0, FontSize: 0, FontID: 0,
        FontColor: "#FFFFFF", BgColor: "#00000000",
        PicData: png.toString("base64"),
        ImgLocalFlag: 0,
      },
    ],
  });
  console.log("  → Expected: Yellow text + red/green bars with white text");
}

/** Test 6: BackgroudImageAddr with PNG data */
async function test6_bgImagePng() {
  console.log("\n═══ TEST 6: BackgroudImageAddr as PNG data ═══");
  const png = makeTestPng(800, 1280);
  console.log(`  PNG size: ${(png.length / 1024).toFixed(1)}KB`);

  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: png.toString("base64"),
    DispList: [
      {
        ID: 1, Type: "Text",
        StartX: 16, StartY: 600, Width: 768, Height: 44,
        Align: 0, FontSize: 36, FontID: 52,
        FontColor: "#FFFFFF", BgColor: "#00000000",
        TextMessage: "TEST 6: BG PNG DATA",
      },
    ],
  });
  console.log("  → Expected: Background image + white text overlay");
}

/** Test 7: Device/PlayTFGif at 1080x1920 (actual screen resolution?) */
async function test7_nativeRes() {
  console.log("\n═══ TEST 7: PlayTFGif at 1080x1920 ═══");
  // Only use a small portion to keep payload manageable
  const rgb = makeRgbPixels(1080, 1920, 0, 255, 0);
  console.log(`  RGB size: ${(rgb.length / 1024 / 1024).toFixed(1)}MB`);

  await sendCommand("Device/PlayTFGif", {
    PicNum: 1,
    PicWidth: 1080,
    PicHeight: 1920,
    PicOffset: 0,
    PicID: 1,
    PicSpeed: 1000,
    PicData: rgb.toString("base64"),
  });
  console.log("  → Expected: Solid green screen (if native res is 1080x1920)");
}

/** Test 8: Channel/SetCustomPageIndex (maybe we need to switch channel?) */
async function test8_channelSwitch() {
  console.log("\n═══ TEST 8: Switch to custom channel ═══");
  // Try switching to custom page channel
  await sendCommand("Channel/SetIndex", { SelectIndex: 3 }); // 3 = custom channel on Pixoo
  await new Promise(r => setTimeout(r, 1000));

  // Now try PlayTFGif
  const png = makeTestPng(800, 1280);
  await sendCommand("Device/PlayTFGif", {
    PicNum: 1,
    PicWidth: 800,
    PicHeight: 1280,
    PicOffset: 0,
    PicID: 1,
    PicSpeed: 1000,
    PicData: png.toString("base64"),
  });
  console.log("  → Expected: Test image (if channel switch was needed)");
}

/** Test 9: Try Draw/SendHttpGif (Pixoo standard) with smaller payload and longer timeout */
async function test9_drawSendSmallPng() {
  console.log("\n═══ TEST 9: Draw/SendHttpGif with small PNG ═══");
  // Try 64x64 like a Pixoo — maybe the TimesFrame also supports this for its Pixoo layer?
  const rgb = makeRgbPixels(64, 64, 255, 165, 0); // orange

  await sendCommand("Draw/SendHttpGif", {
    PicNum: 1,
    PicWidth: 64,
    PicOffset: 0,
    PicID: 1,
    PicSpeed: 1000,
    PicData: rgb.toString("base64"),
  });
  console.log("  → Expected: Small orange square (Pixoo compatibility mode)");
}

/** Test 10: Just list all supported commands (attempt) */
async function test10_getCapabilities() {
  console.log("\n═══ TEST 10: Probe device capabilities ═══");

  // Try various info commands
  const commands = [
    "Device/GetDeviceType",
    "Device/GetDeviceVersion",
    "Device/GetDeviceSetting",
    "Channel/GetIndex",
    "Device/GetBrightness",
    "System/LogAndReturn",
  ];

  for (const cmd of commands) {
    await sendCommand(cmd);
  }
}

// ─── Runner ──────────────────────────────────────

const testNum = parseInt(process.argv[2] || "0", 10);
const tests = [
  test1_playTfGif_png,
  test2_playTfGif_rgba,
  test3_resetThenPlay,
  test4_httpsUrl,
  test5_imageElement_pngData,
  test6_bgImagePng,
  test7_nativeRes,
  test8_channelSwitch,
  test9_drawSendSmallPng,
  test10_getCapabilities,
];

async function run() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  TimesFrame Image Diagnostics — Round 3         ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`Device: ${DEVICE_URL}`);

  const info = await sendCommand("Device/GetDeviceId");
  if (!info) {
    console.error("\n✗ Device unreachable.");
    process.exit(1);
  }
  console.log("✓ Device reachable\n");

  if (testNum > 0 && testNum <= tests.length) {
    await tests[testNum - 1]();
    console.log(`\n→ Check the device now.`);
  } else {
    for (const [i, test] of tests.entries()) {
      await test();
      if (i < tests.length - 1) {
        console.log("\n  ⏳ Waiting 6 seconds...");
        await new Promise(r => setTimeout(r, 6000));
      }
    }
    console.log("\n═══ ALL TESTS COMPLETE ═══");
  }
}

run().catch(console.error);
