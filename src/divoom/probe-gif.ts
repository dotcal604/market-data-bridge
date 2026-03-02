/**
 * Divoom TimesFrame — Draw/SendHttpGif Deep Probe
 *
 * Draw/SendHttpGif was accepted (ReturnCode: 0) by the TimesFrame!
 * This is the Pixoo-64 raw pixel data API.
 *
 * On Pixoo-64: PicWidth=64 → 64×64 pixel grid, 3 bytes/pixel (RGB), base64-encoded.
 * The TimesFrame display is 800×480 physical pixels.
 *
 * This probe tests:
 *   1. Different PicWidth values (what's the device's native pixel grid?)
 *   2. Gradient patterns (easier to spot than solid color)
 *   3. Multi-frame animation (PicNum > 1)
 *   4. Whether it overlays or replaces CustomControlMode
 *
 * Run: npx tsx src/divoom/probe-gif.ts [test-name]
 *
 * Tests:
 *   sizes      — Try different PicWidth values (16, 32, 64, 128, 160, 200)
 *   gradient   — Send a gradient at PicWidth=64 (Pixoo-64 native)
 *   large      — Try 320×320 and 400×400 (TimesFrame-scale)
 *   overlay    — Send Draw/SendHttpGif AFTER EnterCustomControlMode
 *   animate    — Send 3-frame animation
 *   all        — Run all tests
 */

const DEVICE_IP = "192.168.0.48";
const DEVICE_PORT = 9000;
const DEVICE_URL = `http://${DEVICE_IP}:${DEVICE_PORT}/divoom_api`;

// ─── Helpers ────────────────────────────────────────────────

async function sendCommand(command: string, payload: Record<string, unknown> = {}): Promise<any> {
  const body = { Command: command, ...payload };
  console.log(`\n→ ${command}`);

  const payloadKeys = Object.keys(payload);
  const dataSize = JSON.stringify(body).length;
  console.log(`  payload keys: ${payloadKeys.join(", ")} (${dataSize} bytes JSON)`);

  try {
    const response = await fetch(DEVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    console.log(`  ← ReturnCode: ${data.ReturnCode ?? "?"}, Message: ${data.ReturnMessage ?? ""}`);
    return data;
  } catch (err: any) {
    console.log(`  ✗ Error: ${err.message}`);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a solid color pixel buffer (RGB, 3 bytes per pixel)
 */
function solidColor(width: number, r: number, g: number, b: number): string {
  const pixels = width * width;
  const buf = Buffer.alloc(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    buf[i * 3] = r;
    buf[i * 3 + 1] = g;
    buf[i * 3 + 2] = b;
  }
  return buf.toString("base64");
}

/**
 * Generate a red-green-blue horizontal gradient
 */
function gradient(width: number): string {
  const pixels = width * width;
  const buf = Buffer.alloc(pixels * 3);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      // Top third: red, middle third: green, bottom third: blue
      const section = Math.floor(y / (width / 3));
      if (section === 0) {
        buf[i] = 255; buf[i + 1] = 0; buf[i + 2] = 0;
      } else if (section === 1) {
        buf[i] = 0; buf[i + 1] = 255; buf[i + 2] = 0;
      } else {
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 255;
      }
      // Fade brightness left to right
      const brightness = Math.floor((x / width) * 255);
      buf[i] = Math.min(buf[i], brightness + 50);
      buf[i + 1] = Math.min(buf[i + 1], brightness + 50);
      buf[i + 2] = Math.min(buf[i + 2], brightness + 50);
    }
  }
  return buf.toString("base64");
}

/**
 * Generate a checkerboard pattern (red/white)
 */
function checkerboard(width: number, squareSize: number = 8): string {
  const pixels = width * width;
  const buf = Buffer.alloc(pixels * 3);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const isWhite = (Math.floor(x / squareSize) + Math.floor(y / squareSize)) % 2 === 0;
      if (isWhite) {
        buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255;
      } else {
        buf[i] = 255; buf[i + 1] = 0; buf[i + 2] = 0;
      }
    }
  }
  return buf.toString("base64");
}

// ─── Test 1: Different PicWidth sizes ───────────────────────

async function testSizes() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: Different PicWidth values — what's the native grid?");
  console.log("=".repeat(60));
  console.log("Pixoo-64 uses PicWidth=64. TimesFrame is 800×480 physical.");
  console.log("Sending BRIGHT RED solid frames at each size.\n");

  const sizes = [16, 32, 64, 128, 160];

  for (const size of sizes) {
    const pixelCount = size * size;
    const byteCount = pixelCount * 3;
    const b64 = solidColor(size, 255, 0, 0);

    console.log(`\n--- PicWidth=${size} (${pixelCount} pixels, ${byteCount} RGB bytes, ${b64.length} base64 chars) ---`);

    const result = await sendCommand("Draw/SendHttpGif", {
      PicNum: 1,
      PicWidth: size,
      PicOffset: 0,
      PicID: 1,
      PicSpeed: 1000,
      PicData: b64,
    });

    if (result?.ReturnCode === 0) {
      console.log(`  ✓ Accepted! Check device for ${size}×${size} red fill.`);
    }

    await sleep(5000);
  }

  console.log("\n📺 Which size showed something on the device?");
}

// ─── Test 2: Gradient at standard Pixoo size ────────────────

async function testGradient() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: RGB gradient at PicWidth=64 (Pixoo-64 standard)");
  console.log("=".repeat(60));
  console.log("Red top → Green middle → Blue bottom, brightness L→R");

  const b64 = gradient(64);
  console.log(`  Pixel data: ${64*64} pixels, ${b64.length} base64 chars`);

  await sendCommand("Draw/SendHttpGif", {
    PicNum: 1,
    PicWidth: 64,
    PicOffset: 0,
    PicID: 1,
    PicSpeed: 1000,
    PicData: b64,
  });

  console.log("\n📺 CHECK: Do you see a gradient pattern? (red/green/blue stripes)");
  console.log("   This would prove the pixel buffer format is correct.");
}

// ─── Test 3: Larger sizes closer to TimesFrame resolution ───

async function testLarge() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: Large pixel buffers (TimesFrame-scale)");
  console.log("=".repeat(60));
  console.log("WARNING: Large payloads. If device freezes, power cycle.\n");

  // Try checkerboard patterns — easier to confirm visually
  const sizes = [200, 320];

  for (const size of sizes) {
    const b64 = checkerboard(size, Math.max(4, Math.floor(size / 16)));
    const jsonSize = JSON.stringify({
      Command: "Draw/SendHttpGif",
      PicNum: 1, PicWidth: size, PicOffset: 0, PicID: 1,
      PicSpeed: 1000, PicData: b64,
    }).length;

    console.log(`\n--- PicWidth=${size} (${size*size} pixels, ${jsonSize} bytes JSON) ---`);

    // Safety: don't send if over 2MB (device crashed at 3MB before)
    if (jsonSize > 2_000_000) {
      console.log(`  ⚠ Skipping: ${(jsonSize / 1_000_000).toFixed(1)}MB exceeds 2MB safety limit`);
      continue;
    }

    await sendCommand("Draw/SendHttpGif", {
      PicNum: 1,
      PicWidth: size,
      PicOffset: 0,
      PicID: 1,
      PicSpeed: 1000,
      PicData: b64,
    });

    await sleep(5000);
  }

  console.log("\n📺 CHECK: Red/white checkerboard at any size?");
}

// ─── Test 4: Overlay on CustomControlMode ───────────────────

async function testOverlay() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: Draw/SendHttpGif OVER CustomControlMode");
  console.log("=".repeat(60));
  console.log("First set up text, then overlay pixel data.\n");

  // Step 1: Set up CustomControlMode with green text
  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: "",
    DispList: [
      {
        ID: 1, Type: "Text",
        StartX: 16, StartY: 100,
        Width: 768, Height: 100,
        Align: 0, FontSize: 48, FontID: 52,
        FontColor: "#00FF00", BgColor: "#00000000",
        TextMessage: "TEXT UNDER GIF?",
      },
      {
        ID: 2, Type: "Text",
        StartX: 16, StartY: 600,
        Width: 768, Height: 100,
        Align: 0, FontSize: 48, FontID: 52,
        FontColor: "#00FF00", BgColor: "#00000000",
        TextMessage: "BOTTOM TEXT",
      },
    ],
  });

  console.log("  Sent CustomControlMode with 2 text elements.");
  await sleep(3000);

  // Step 2: Send pixel data on top
  const b64 = checkerboard(64);
  await sendCommand("Draw/SendHttpGif", {
    PicNum: 1,
    PicWidth: 64,
    PicOffset: 0,
    PicID: 1,
    PicSpeed: 1000,
    PicData: b64,
  });

  console.log("\n📺 CHECK: Do you see:");
  console.log("   a) Checkerboard + text visible together (overlay mode)");
  console.log("   b) Only checkerboard (gif replaces custom mode)");
  console.log("   c) Only text (gif was ignored)");
  console.log("   d) Nothing (both failed)");
}

// ─── Test 5: Animation (multiple frames) ────────────────────

async function testAnimate() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: 3-frame animation via Draw/SendHttpGif");
  console.log("=".repeat(60));
  console.log("Red → Green → Blue cycling at 1s per frame.\n");

  const size = 64;
  const colors: [number, number, number][] = [
    [255, 0, 0],   // red
    [0, 255, 0],   // green
    [0, 0, 255],   // blue
  ];

  for (let i = 0; i < colors.length; i++) {
    const [r, g, b] = colors[i];
    const colorName = ["RED", "GREEN", "BLUE"][i];
    const b64 = solidColor(size, r, g, b);

    console.log(`\n--- Frame ${i}/${colors.length}: ${colorName} ---`);

    await sendCommand("Draw/SendHttpGif", {
      PicNum: colors.length,
      PicWidth: size,
      PicOffset: i,
      PicID: i,
      PicSpeed: 1000,
      PicData: b64,
    });
  }

  console.log("\n📺 CHECK: Does the display cycle through Red → Green → Blue?");
  console.log("   If yes → we have full animation support via Draw/SendHttpGif!");
}

// ─── Main ───────────────────────────────────────────────────

const TEST_MAP: Record<string, () => Promise<void>> = {
  sizes: testSizes,
  gradient: testGradient,
  large: testLarge,
  overlay: testOverlay,
  animate: testAnimate,
};

async function runAll() {
  const tests = ["sizes", "gradient", "overlay", "animate"];

  for (const name of tests) {
    await TEST_MAP[name]();
    console.log(`\n⏳ Pausing 5s before next test...`);
    await sleep(5000);
  }

  console.log("\n" + "=".repeat(60));
  console.log("ALL Draw/SendHttpGif TESTS COMPLETE");
  console.log("=".repeat(60));
}

async function main() {
  const testName = process.argv[2] ?? "all";

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  TimesFrame Draw/SendHttpGif Deep Probe                 ║");
  console.log("║  Testing Pixoo-64 pixel API on TimesFrame               ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`Device: ${DEVICE_URL}`);
  console.log(`Running: ${testName}`);

  if (testName === "all") {
    await runAll();
  } else if (TEST_MAP[testName]) {
    await TEST_MAP[testName]();
  } else {
    console.log(`Unknown test: ${testName}`);
    console.log(`Available: ${Object.keys(TEST_MAP).join(", ")}, all`);
    process.exit(1);
  }
}

main().catch(console.error);
