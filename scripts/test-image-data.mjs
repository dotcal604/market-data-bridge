#!/usr/bin/env node
/**
 * Diagnostic: Test image DATA approaches on TimesFrame device.
 * Previous tests proved the device ignores Image Url fields entirely.
 * Now testing: base64 pixel data, PicData field, Draw/SendHttpGif, PlayTFGif.
 *
 * Usage: node scripts/test-image-data.mjs [test-number]
 */

const DEVICE_IP = "192.168.0.48";
const DEVICE_PORT = 9000;
const DEVICE_URL = `http://${DEVICE_IP}:${DEVICE_PORT}/divoom_api`;

async function sendCommand(command, payload = {}) {
  const body = { Command: command, ...payload };
  console.log(`\n→ Sending: ${command}`);
  const payloadStr = JSON.stringify(body);
  console.log(`  Payload size: ${payloadStr.length} bytes`);
  console.log(`  Payload keys: ${Object.keys(payload).join(", ")}`);

  try {
    const res = await fetch(DEVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payloadStr,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    console.log(`  ← Response: ${JSON.stringify(data)}`);
    return data;
  } catch (err) {
    console.error(`  ✗ Error: ${err.message}`);
    return null;
  }
}

// ─── Generate test pixel data ────────────────────

/**
 * Generate raw RGB pixel data for a solid-color rectangle.
 * Returns base64-encoded string of [R,G,B,R,G,B,...] bytes.
 */
function makePixelData(width, height, r, g, b) {
  const buf = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    buf[i * 3] = r;
    buf[i * 3 + 1] = g;
    buf[i * 3 + 2] = b;
  }
  return buf.toString("base64");
}

/**
 * Generate raw RGB pixel data with a gradient pattern (easier to see if it works).
 */
function makeGradientData(width, height) {
  const buf = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      buf[i] = Math.floor((x / width) * 255);     // R: left-to-right gradient
      buf[i + 1] = Math.floor((y / height) * 255); // G: top-to-bottom gradient
      buf[i + 2] = 128;                             // B: constant mid-blue
    }
  }
  return buf.toString("base64");
}

// ─── Test Cases ──────────────────────────────────

/** Test 1: Draw/SendHttpGif — standard Pixoo approach at full 800px width */
async function test1_sendHttpGif_fullscreen() {
  console.log("\n═══ TEST 1: Draw/SendHttpGif (800x1280 full screen) ═══");
  const picData = makeGradientData(800, 1280);
  console.log(`  PicData length: ${picData.length} chars (${(picData.length / 1024).toFixed(0)}KB)`);

  await sendCommand("Draw/SendHttpGif", {
    PicNum: 1,
    PicWidth: 800,
    PicOffset: 0,
    PicID: 1,
    PicSpeed: 1000,
    PicData: picData,
  });
  console.log("  → Expected: Full-screen gradient (red→right, green→bottom)");
}

/** Test 2: Draw/SendHttpGif — small 100x100 */
async function test2_sendHttpGif_small() {
  console.log("\n═══ TEST 2: Draw/SendHttpGif (100x100 small) ═══");
  const picData = makePixelData(100, 100, 255, 0, 0); // solid red

  await sendCommand("Draw/SendHttpGif", {
    PicNum: 1,
    PicWidth: 100,
    PicOffset: 0,
    PicID: 1,
    PicSpeed: 1000,
    PicData: picData,
  });
  console.log("  → Expected: Small red square (if device accepts non-native sizes)");
}

/** Test 3: Device/PlayTFGif — TimesFrame-specific command */
async function test3_playTFGif() {
  console.log("\n═══ TEST 3: Device/PlayTFGif ═══");
  const picData = makeGradientData(800, 1280);

  // Try with same structure as Draw/SendHttpGif
  await sendCommand("Device/PlayTFGif", {
    PicNum: 1,
    PicWidth: 800,
    PicOffset: 0,
    PicID: 1,
    PicSpeed: 1000,
    PicData: picData,
  });
  console.log("  → Expected: Full-screen gradient (if PlayTFGif uses same format)");
}

/** Test 4: Device/PlayTFGif with FileId — maybe it expects a gallery file */
async function test4_playTFGif_url() {
  console.log("\n═══ TEST 4: Device/PlayTFGif with Url/FileId ═══");

  // Try various field names
  await sendCommand("Device/PlayTFGif", {
    Url: "http://192.168.0.47:3000/api/divoom/charts/vix-gauge",
    FileId: "test",
  });
  console.log("  → Expected: Image from URL (if PlayTFGif fetches URLs)");
}

/** Test 5: Image element with PicData (base64 pixel data) instead of Url */
async function test5_imageWithPicData() {
  console.log("\n═══ TEST 5: Image element with PicData field ═══");
  const picData = makePixelData(400, 300, 0, 255, 0); // solid green

  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: "",
    DispList: [
      {
        ID: 1, Type: "Text",
        StartX: 16, StartY: 50, Width: 768, Height: 44,
        Align: 0, FontSize: 36, FontID: 52,
        FontColor: "#FFFF00", BgColor: "#00000000",
        TextMessage: "TEST 5: PicData",
      },
      {
        ID: 2, Type: "Image",
        StartX: 16, StartY: 120, Width: 400, Height: 300,
        Align: 0, FontSize: 0, FontID: 0,
        FontColor: "#FFFFFF", BgColor: "#00000000",
        PicData: picData,
        ImgLocalFlag: 0,
      },
    ],
  });
  console.log("  → Expected: Yellow text + green rectangle (if PicData accepted inline)");
}

/** Test 6: Image element with base64 data URI in Url field */
async function test6_imageDataUri() {
  console.log("\n═══ TEST 6: Image element with data: URI in Url ═══");
  // 1x1 red pixel PNG (minimal valid PNG)
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: "",
    DispList: [
      {
        ID: 1, Type: "Text",
        StartX: 16, StartY: 50, Width: 768, Height: 44,
        Align: 0, FontSize: 36, FontID: 52,
        FontColor: "#FF00FF", BgColor: "#00000000",
        TextMessage: "TEST 6: DATA URI",
      },
      {
        ID: 2, Type: "Image",
        StartX: 16, StartY: 120, Width: 400, Height: 300,
        Align: 0, FontSize: 0, FontID: 0,
        FontColor: "#FFFFFF", BgColor: "#00000000",
        Url: `data:image/png;base64,${pngBase64}`,
        ImgLocalFlag: 0,
      },
    ],
  });
  console.log("  → Expected: Pink text + red square (if data URIs work)");
}

/** Test 7: BackgroudImageAddr with base64 pixel data */
async function test7_bgPicData() {
  console.log("\n═══ TEST 7: BackgroudImageAddr with PicData ═══");
  const picData = makeGradientData(800, 1280);

  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: "",
    BackgroudPicData: picData,
    DispList: [
      {
        ID: 1, Type: "Text",
        StartX: 16, StartY: 100, Width: 768, Height: 44,
        Align: 0, FontSize: 36, FontID: 52,
        FontColor: "#FFFFFF", BgColor: "#00000000",
        TextMessage: "TEST 7: BG PICDATA",
      },
    ],
  });
  console.log("  → Expected: Gradient background + white text (if BackgroudPicData works)");
}

/** Test 8: Sys/PlayTFGif (alternative namespace) */
async function test8_sysPlayTFGif() {
  console.log("\n═══ TEST 8: Sys/PlayTFGif ═══");
  const picData = makeGradientData(800, 1280);

  await sendCommand("Sys/PlayTFGif", {
    PicNum: 1,
    PicWidth: 800,
    PicOffset: 0,
    PicID: 1,
    PicSpeed: 1000,
    PicData: picData,
  });
  console.log("  → Expected: Full-screen gradient (if Sys/PlayTFGif exists)");
}

// ─── Runner ──────────────────────────────────────

const testNum = parseInt(process.argv[2] || "0", 10);
const tests = [
  test1_sendHttpGif_fullscreen,
  test2_sendHttpGif_small,
  test3_playTFGif,
  test4_playTFGif_url,
  test5_imageWithPicData,
  test6_imageDataUri,
  test7_bgPicData,
  test8_sysPlayTFGif,
];

async function run() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  TimesFrame Image DATA Diagnostics (Round 2)    ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`Device: ${DEVICE_URL}`);

  const info = await sendCommand("Device/GetDeviceId");
  if (!info) {
    console.error("\n✗ Device unreachable. Check IP and power.");
    process.exit(1);
  }
  console.log("✓ Device reachable\n");

  if (testNum > 0 && testNum <= tests.length) {
    await tests[testNum - 1]();
    console.log(`\n→ Check the device now.`);
  } else {
    // Run all with pauses
    for (const [i, test] of tests.entries()) {
      await test();
      if (i < tests.length - 1) {
        console.log("\n  ⏳ Waiting 8 seconds for device to render...");
        await new Promise(r => setTimeout(r, 8000));
      }
    }
    console.log("\n═══ ALL TESTS COMPLETE ═══");
    console.log("Which test showed an image? That reveals the correct approach.");
  }
}

run().catch(console.error);
