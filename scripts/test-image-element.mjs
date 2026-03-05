#!/usr/bin/env node
/**
 * Diagnostic: Test Image element rendering on TimesFrame device.
 * Sends minimal payloads to isolate why Image elements are invisible.
 *
 * Usage: node scripts/test-image-element.mjs
 */

const DEVICE_IP = "192.168.0.48";
const DEVICE_PORT = 9000;
const DEVICE_URL = `http://${DEVICE_IP}:${DEVICE_PORT}/divoom_api`;

// A small, well-known public PNG (1x1 red pixel, base64)
const TEST_IMAGE_URL = "http://192.168.0.47:3000/api/divoom/charts/vix-gauge";
// Public test image (httpbin)
const PUBLIC_IMAGE_URL = "https://httpbin.org/image/png";

async function sendCommand(command, payload = {}) {
  const body = { Command: command, ...payload };
  console.log(`\n→ Sending: ${command}`);
  console.log(`  Payload keys: ${Object.keys(payload).join(", ")}`);

  try {
    const res = await fetch(DEVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    console.log(`  ← Response: ${JSON.stringify(data)}`);
    return data;
  } catch (err) {
    console.error(`  ✗ Error: ${err.message}`);
    return null;
  }
}

// ─── Test Cases ──────────────────────────────────

/** Test 1: Baseline — just one Text element (should work) */
async function test1_textOnly() {
  console.log("\n═══ TEST 1: Text-only baseline ═══");
  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: "",
    DispList: [
      {
        ID: 1, Type: "Text",
        StartX: 16, StartY: 100, Width: 768, Height: 44,
        Align: 0, FontSize: 36, FontID: 52,
        FontColor: "#00FF00", BgColor: "#00000000",
        TextMessage: "TEST 1: TEXT ONLY",
      },
    ],
  });
  console.log("  → Expected: Green text visible on device");
}

/** Test 2: Image element with Url field (current approach) */
async function test2_imageWithUrl() {
  console.log("\n═══ TEST 2: Image with 'Url' field ═══");
  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: "",
    DispList: [
      {
        ID: 1, Type: "Text",
        StartX: 16, StartY: 50, Width: 768, Height: 44,
        Align: 0, FontSize: 36, FontID: 52,
        FontColor: "#00FF00", BgColor: "#00000000",
        TextMessage: "TEST 2: Url FIELD",
      },
      {
        ID: 2, Type: "Image",
        StartX: 16, StartY: 120, Width: 400, Height: 300,
        Align: 0, FontSize: 0, FontID: 0,
        FontColor: "#FFFFFF", BgColor: "#00000000",
        Url: TEST_IMAGE_URL,
        ImgLocalFlag: 0,
      },
    ],
  });
  console.log("  → Expected: Green text + image below it");
}

/** Test 3: Image element with PicUrl field instead */
async function test3_imageWithPicUrl() {
  console.log("\n═══ TEST 3: Image with 'PicUrl' field ═══");
  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: "",
    DispList: [
      {
        ID: 1, Type: "Text",
        StartX: 16, StartY: 50, Width: 768, Height: 44,
        Align: 0, FontSize: 36, FontID: 52,
        FontColor: "#FF0000", BgColor: "#00000000",
        TextMessage: "TEST 3: PicUrl FIELD",
      },
      {
        ID: 2, Type: "Image",
        StartX: 16, StartY: 120, Width: 400, Height: 300,
        Align: 0, FontSize: 0, FontID: 0,
        FontColor: "#FFFFFF", BgColor: "#00000000",
        PicUrl: TEST_IMAGE_URL,
        ImgLocalFlag: 0,
      },
    ],
  });
  console.log("  → Expected: Red text + image (if PicUrl is correct)");
}

/** Test 4: Image element with ImgUrl field */
async function test4_imageWithImgUrl() {
  console.log("\n═══ TEST 4: Image with 'ImgUrl' field ═══");
  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: "",
    DispList: [
      {
        ID: 1, Type: "Text",
        StartX: 16, StartY: 50, Width: 768, Height: 44,
        Align: 0, FontSize: 36, FontID: 52,
        FontColor: "#0000FF", BgColor: "#00000000",
        TextMessage: "TEST 4: ImgUrl FIELD",
      },
      {
        ID: 2, Type: "Image",
        StartX: 16, StartY: 120, Width: 400, Height: 300,
        Align: 0, FontSize: 0, FontID: 0,
        FontColor: "#FFFFFF", BgColor: "#00000000",
        ImgUrl: TEST_IMAGE_URL,
        ImgLocalFlag: 0,
      },
    ],
  });
  console.log("  → Expected: Blue text + image (if ImgUrl is correct)");
}

/** Test 5: BackgroudImageAddr as the image (maybe that's how it works?) */
async function test5_backgroundImage() {
  console.log("\n═══ TEST 5: BackgroudImageAddr as image ═══");
  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: TEST_IMAGE_URL,
    DispList: [
      {
        ID: 1, Type: "Text",
        StartX: 16, StartY: 50, Width: 768, Height: 44,
        Align: 0, FontSize: 36, FontID: 52,
        FontColor: "#FFFF00", BgColor: "#00000000",
        TextMessage: "TEST 5: BG IMAGE",
      },
    ],
  });
  console.log("  → Expected: Yellow text + background image (if BG URL works)");
}

/** Test 6: Minimal Image — no font fields, just essentials */
async function test6_minimalImage() {
  console.log("\n═══ TEST 6: Minimal Image (no font fields) ═══");
  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: "",
    DispList: [
      {
        ID: 1, Type: "Text",
        StartX: 16, StartY: 50, Width: 768, Height: 44,
        Align: 0, FontSize: 36, FontID: 52,
        FontColor: "#FF00FF", BgColor: "#00000000",
        TextMessage: "TEST 6: MINIMAL IMG",
      },
      {
        ID: 2, Type: "Image",
        StartX: 16, StartY: 120, Width: 400, Height: 300,
        Url: TEST_IMAGE_URL,
      },
    ],
  });
  console.log("  → Expected: Pink text + image (if minimal struct works)");
}

// ─── Runner ──────────────────────────────────────

const testNum = parseInt(process.argv[2] || "0", 10);

async function run() {
  console.log("╔═══════════════════════════════════════════╗");
  console.log("║  TimesFrame Image Element Diagnostics     ║");
  console.log("╚═══════════════════════════════════════════╝");
  console.log(`Device: ${DEVICE_URL}`);
  console.log(`Image URL: ${TEST_IMAGE_URL}`);

  // First verify device is reachable
  const info = await sendCommand("Device/GetDeviceId");
  if (!info) {
    console.error("\n✗ Device unreachable. Check IP and power.");
    process.exit(1);
  }
  console.log("✓ Device reachable\n");

  if (testNum > 0 && testNum <= 6) {
    const tests = [test1_textOnly, test2_imageWithUrl, test3_imageWithPicUrl,
                   test4_imageWithImgUrl, test5_backgroundImage, test6_minimalImage];
    await tests[testNum - 1]();
    console.log(`\n→ Check the device now. Wait 5 seconds then run next test.`);
  } else {
    // Run all with pauses
    for (const [i, test] of [test1_textOnly, test2_imageWithUrl, test3_imageWithPicUrl,
                              test4_imageWithImgUrl, test5_backgroundImage, test6_minimalImage].entries()) {
      await test();
      if (i < 5) {
        console.log("\n  ⏳ Waiting 8 seconds for device to render...");
        await new Promise(r => setTimeout(r, 8000));
      }
    }
    console.log("\n═══ ALL TESTS COMPLETE ═══");
    console.log("Which test showed an image? That reveals the correct field name.");
  }
}

run().catch(console.error);
