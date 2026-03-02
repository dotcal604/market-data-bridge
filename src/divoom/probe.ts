/**
 * Divoom TimesFrame Protocol Probe
 *
 * Systematic fuzzing of the device API to discover working Image rendering.
 * Run: npx tsx src/divoom/probe.ts [test-name]
 *
 * Tests (in order of likelihood):
 *   bg-stripes   — DEFINITIVE: stripes/green/blue as BackgroudImageAddr
 *   background   — BackgroudImageAddr with solid red
 *   field-names  — Try different URL field names in Image elements
 *   pixoo-api    — Try Pixoo-64 commands (Draw/SendHttpGif, Draw/SendDisplayList)
 *   numeric-type — Try numeric Type codes instead of string "Image"
 *   base64       — Try embedding base64 image data directly
 *   all          — Run all tests sequentially (5s pause between each)
 */

const DEVICE_IP = "192.168.0.48";
const DEVICE_PORT = 9000;
const DEVICE_URL = `http://${DEVICE_IP}:${DEVICE_PORT}/divoom_api`;

// Test pattern URLs — ?brightness=0-100 (default 30 for transparent panel)
const BRI = 30; // % brightness — lower = more transparent on glass
const TEST_IMAGE_URL = `http://192.168.0.47:3000/api/divoom/charts/test-red?brightness=${BRI}`;
const TEST_STRIPES_URL = `http://192.168.0.47:3000/api/divoom/charts/test-stripes?brightness=${BRI}`;
const TEST_GREEN_URL = `http://192.168.0.47:3000/api/divoom/charts/test-green?brightness=${BRI}`;
const TEST_BLUE_URL = `http://192.168.0.47:3000/api/divoom/charts/test-blue?brightness=${BRI}`;
// Regular chart PNG
const CHART_PNG_URL = "http://192.168.0.47:3000/api/divoom/charts/spy-sparkline";

// ─── Helpers ────────────────────────────────────────────────

async function sendCommand(command: string, payload: Record<string, unknown> = {}): Promise<any> {
  const body = { Command: command, ...payload };
  console.log(`\n→ ${command}`);
  console.log(`  payload keys: ${Object.keys(payload).join(", ")}`);

  try {
    const response = await fetch(DEVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
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

/** A simple Text element that always works — used as visual anchor */
function anchorText(id: number, y: number, text: string): Record<string, unknown> {
  return {
    ID: id,
    Type: "Text",
    StartX: 16,
    StartY: y,
    Width: 768,
    Height: 44,
    Align: 0,
    FontSize: 36,
    FontID: 52,
    FontColor: "#00FF00",
    BgColor: "#00000000",
    TextMessage: text,
  };
}

// ─── Test 1: BackgroudImageAddr ─────────────────────────────

async function testBackground() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 1: BackgroudImageAddr — full-screen background image");
  console.log("=".repeat(60));
  console.log("If this works → device CAN render images, just not via DispList");
  console.log(`URL: ${TEST_IMAGE_URL}`);

  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: TEST_IMAGE_URL,
    DispList: [
      anchorText(1, 100, "BG IMAGE TEST"),
      anchorText(2, 200, "If red behind this = BG works"),
    ],
  });

  console.log("\n📺 CHECK DEVICE: Do you see a RED background behind green text?");
  console.log("   If YES → BackgroudImageAddr is the image channel!");
  console.log("   If NO  → Device ignores BackgroudImageAddr too");
}

// ─── Test 1b: BackgroudImageAddr with STRIPE pattern ────────
// This is the definitive test. Solid black replacing cyan could be a
// "no image loaded" default. Diagonal stripes are unmistakable proof.

async function testBackgroundStripes() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 1b: BackgroudImageAddr — STRIPE PATTERN (definitive)");
  console.log("=".repeat(60));
  console.log("Solid black → cyan could be a default. Stripes are unmistakable.");

  // Step 1: Stripes
  console.log(`\n--- Step 1: Diagonal stripes (cyan/magenta) ---`);
  console.log(`URL: ${TEST_STRIPES_URL}`);
  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: TEST_STRIPES_URL,
    DispList: [
      anchorText(1, 300, "STRIPE BG TEST"),
      anchorText(2, 400, "Diagonal lines behind = CONFIRMED"),
    ],
  });
  console.log("\n📺 LOOK NOW: Do you see diagonal cyan/magenta stripes?");
  console.log("   STRIPES visible → BackgroudImageAddr RENDERS content ✓");
  console.log("   Black or cyan   → BackgroudImageAddr is NOT rendering");
  await sleep(10000);

  // Step 2: Solid green (different from anchor text green)
  console.log(`\n--- Step 2: Solid GREEN background ---`);
  console.log(`URL: ${TEST_GREEN_URL}`);
  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: TEST_GREEN_URL,
    DispList: [
      anchorText(1, 300, "GREEN BG TEST"),
      anchorText(2, 400, "Green everywhere = BG renders"),
    ],
  });
  console.log("\n📺 LOOK NOW: Is the ENTIRE background bright green?");
  await sleep(10000);

  // Step 3: Solid blue
  console.log(`\n--- Step 3: Solid BLUE background ---`);
  console.log(`URL: ${TEST_BLUE_URL}`);
  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: TEST_BLUE_URL,
    DispList: [
      anchorText(1, 300, "BLUE BG TEST"),
      anchorText(2, 400, "Blue everywhere = BG renders"),
    ],
  });
  console.log("\n📺 LOOK NOW: Is the ENTIRE background bright blue?");
  await sleep(10000);

  // Step 4: Back to black (restore)
  console.log(`\n--- Step 4: Restore solid BLACK background ---`);
  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: "http://192.168.0.47:3000/api/divoom/charts/bg-black",
    DispList: [
      anchorText(1, 300, "BLACK BG RESTORED"),
      anchorText(2, 400, "Back to transparent glass"),
    ],
  });

  console.log("\n" + "─".repeat(60));
  console.log("VERDICT:");
  console.log("  If stripes + green + blue all showed correctly:");
  console.log("    → BackgroudImageAddr IS a true image rendering path");
  console.log("    → We can composite charts into the background layer!");
  console.log("  If all showed black or cyan:");
  console.log("    → BackgroudImageAddr does NOT render — black was just default");
  console.log("    → Need firmware investigation for image support");
  console.log("─".repeat(60));
}

// ─── Test 2: Different URL field names ──────────────────────

async function testFieldNames() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: Different URL field names for Image elements");
  console.log("=".repeat(60));

  // Try each field name as a separate Image element, stacked vertically
  const fieldVariants = [
    { name: "Url", field: { Url: TEST_IMAGE_URL } },
    { name: "PicUrl", field: { PicUrl: TEST_IMAGE_URL } },
    { name: "ImageAddr", field: { ImageAddr: TEST_IMAGE_URL } },
    { name: "ImgAddr", field: { ImgAddr: TEST_IMAGE_URL } },
    { name: "PicAddr", field: { PicAddr: TEST_IMAGE_URL } },
    { name: "TextMessage-as-URL", field: { TextMessage: TEST_IMAGE_URL } },
  ];

  for (let i = 0; i < fieldVariants.length; i++) {
    const v = fieldVariants[i];
    console.log(`\n--- Variant ${i + 1}/${fieldVariants.length}: ${v.name} ---`);

    const imageEl = {
      ID: 2,
      Type: "Image",
      StartX: 16,
      StartY: 200,
      Width: 400,
      Height: 200,
      Align: 0,
      FontSize: 0,
      FontID: 0,
      FontColor: "#FFFFFF",
      BgColor: "#00000000",
      ImgLocalFlag: 0,
      ...v.field,
    };

    await sendCommand("Device/EnterCustomControlMode", {
      BackgroudImageAddr: "",
      DispList: [
        anchorText(1, 50, `Field: ${v.name}`),
        imageEl,
        anchorText(3, 500, "Red rect below label = works"),
      ],
    });

    console.log(`📺 CHECK DEVICE: See "${v.name}" label + red image below it?`);
    await sleep(6000); // Give time to observe
  }
}

// ─── Test 3: Pixoo-64 API Commands ──────────────────────────

async function testPixooApi() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: Pixoo-64 API commands on TimesFrame");
  console.log("=".repeat(60));

  // Test 3a: Draw/SendDisplayList (Pixoo-64 text overlay command)
  console.log("\n--- 3a: Draw/SendDisplayList ---");
  await sendCommand("Draw/SendDisplayList", {
    ItemList: [
      {
        Id: 1,
        TextType: 23,
        X: 100,
        Y: 200,
        Font: 4,
        Width: 600,
        Height: 100,
        TextAlignment: 0,
        Color: "#00FF00",
        Text: "Pixoo API test",
      },
    ],
  });

  await sleep(3000);

  // Test 3b: Draw/SendHttpItemList (Pixoo-64 HTTP item overlay)
  console.log("\n--- 3b: Draw/SendHttpItemList ---");
  await sendCommand("Draw/SendHttpItemList", {
    ItemList: [
      {
        TextId: 1,
        type: 23,
        x: 100,
        y: 400,
        dir: 0,
        font: 4,
        TextWidth: 600,
        Textheight: 100,
        speed: 0,
        update_time: 0,
        align: 0,
        color: "#FF0000",
        TextString: "HTTP Item test",
      },
    ],
  });

  await sleep(3000);

  // Test 3c: Draw/SendHttpGif (Pixoo-64 raw image data)
  // Create a tiny 4x4 red image as base64
  // RGB format: 3 bytes per pixel, 4x4 = 48 bytes
  const redPixels = Buffer.alloc(4 * 4 * 3, 0);
  for (let i = 0; i < 4 * 4; i++) {
    redPixels[i * 3] = 255;     // R
    redPixels[i * 3 + 1] = 0;   // G
    redPixels[i * 3 + 2] = 0;   // B
  }
  const base64Data = redPixels.toString("base64");

  console.log("\n--- 3c: Draw/SendHttpGif (4x4 red) ---");
  await sendCommand("Draw/SendHttpGif", {
    PicNum: 1,
    PicWidth: 4,
    PicOffset: 0,
    PicID: 1,
    PicSpeed: 1000,
    PicData: base64Data,
  });

  console.log("\n📺 CHECK DEVICE: Any of the Pixoo-64 commands produce visible results?");
}

// ─── Test 4: Numeric Type codes ─────────────────────────────

async function testNumericType() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 4: Numeric Type codes instead of string 'Image'");
  console.log("=".repeat(60));

  // The Pixoo-64 SendHttpItemList uses type: 23 for text.
  // Maybe CustomControlMode uses different numeric codes.
  // Try a range of plausible codes for Image.
  const typeCodes = [1, 2, 3, 6, 7, 22, 23, 76, 77, 78];

  for (const code of typeCodes) {
    console.log(`\n--- Type: ${code} ---`);

    await sendCommand("Device/EnterCustomControlMode", {
      BackgroudImageAddr: "",
      DispList: [
        anchorText(1, 50, `Type code: ${code}`),
        {
          ID: 2,
          Type: code,  // numeric!
          StartX: 16,
          StartY: 200,
          Width: 400,
          Height: 200,
          Align: 0,
          FontSize: 0,
          FontID: 0,
          FontColor: "#FFFFFF",
          BgColor: "#00000000",
          Url: TEST_IMAGE_URL,
          ImgLocalFlag: 0,
        },
      ],
    });

    await sleep(4000);
  }

  console.log("\n📺 CHECK DEVICE: Did any numeric type code produce a visible image?");
}

// ─── Test 5: Base64 inline image data ───────────────────────

async function testBase64() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 5: Base64 image data embedded in element fields");
  console.log("=".repeat(60));

  // Create a small red image as base64 PNG
  // We'll fetch it from our own server and embed it
  let base64Data = "";
  try {
    const resp = await fetch(TEST_IMAGE_URL);
    const buf = Buffer.from(await resp.arrayBuffer());
    base64Data = buf.toString("base64");
    console.log(`Fetched test image: ${buf.length} bytes → ${base64Data.length} base64 chars`);
  } catch (e: any) {
    console.log(`Failed to fetch test image: ${e.message}`);
    return;
  }

  // Try embedding in different fields
  const variants = [
    { name: "TextMessage=base64", field: { TextMessage: base64Data } },
    { name: "Url=data:uri", field: { Url: `data:image/jpeg;base64,${base64Data}` } },
    { name: "PicData=base64", field: { PicData: base64Data } },
    { name: "ImageData=base64", field: { ImageData: base64Data } },
  ];

  for (const v of variants) {
    console.log(`\n--- ${v.name} ---`);

    await sendCommand("Device/EnterCustomControlMode", {
      BackgroudImageAddr: "",
      DispList: [
        anchorText(1, 50, v.name.slice(0, 30)),
        {
          ID: 2,
          Type: "Image",
          StartX: 16,
          StartY: 200,
          Width: 400,
          Height: 200,
          Align: 0,
          FontSize: 0,
          FontID: 0,
          FontColor: "#FFFFFF",
          BgColor: "#00000000",
          ImgLocalFlag: 0,
          ...v.field,
        },
      ],
    });

    await sleep(4000);
  }

  console.log("\n📺 CHECK DEVICE: Did any base64 variant produce a visible image?");
}

// ─── Test 6: BackgroudImageAddr with base64 data URI ────────

async function testBackgroundBase64() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 6: BackgroudImageAddr with base64 data URI");
  console.log("=".repeat(60));

  let base64Data = "";
  try {
    const resp = await fetch(TEST_IMAGE_URL);
    const buf = Buffer.from(await resp.arrayBuffer());
    base64Data = buf.toString("base64");
  } catch (e: any) {
    console.log(`Failed to fetch test image: ${e.message}`);
    return;
  }

  // Try data URI in background
  console.log("\n--- BackgroudImageAddr = data:image/jpeg;base64,... ---");
  await sendCommand("Device/EnterCustomControlMode", {
    BackgroudImageAddr: `data:image/jpeg;base64,${base64Data}`,
    DispList: [
      anchorText(1, 100, "BG BASE64 TEST"),
      anchorText(2, 200, "Red behind = data URI works"),
    ],
  });

  console.log("\n📺 CHECK DEVICE: Red background with green text overlay?");
}

// ─── Test 7: Extra Image element fields ─────────────────────

async function testExtraFields() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 7: Extra undocumented Image element fields");
  console.log("=".repeat(60));

  // Maybe the device needs additional fields to enable rendering
  const extraFieldSets = [
    { name: "DisplayFlag=1", extra: { DisplayFlag: 1 } },
    { name: "ImgType=1", extra: { ImgType: 1 } },
    { name: "ShowFlag=1", extra: { ShowFlag: 1 } },
    { name: "Visible=1", extra: { Visible: 1 } },
    { name: "Enable=1", extra: { Enable: 1 } },
    { name: "PicWidth+PicHeight", extra: { PicWidth: 400, PicHeight: 200 } },
    { name: "ImgWidth+ImgHeight", extra: { ImgWidth: 400, ImgHeight: 200 } },
    { name: "DisplayType=1", extra: { DisplayType: 1 } },
    { name: "RenderMode=1", extra: { RenderMode: 1 } },
    { name: "CacheFlag=0", extra: { CacheFlag: 0 } },
  ];

  for (const v of extraFieldSets) {
    console.log(`\n--- ${v.name} ---`);

    await sendCommand("Device/EnterCustomControlMode", {
      BackgroudImageAddr: "",
      DispList: [
        anchorText(1, 50, v.name),
        {
          ID: 2,
          Type: "Image",
          StartX: 16,
          StartY: 200,
          Width: 400,
          Height: 200,
          Align: 0,
          FontSize: 0,
          FontID: 0,
          FontColor: "#FFFFFF",
          BgColor: "#00000000",
          Url: TEST_IMAGE_URL,
          ImgLocalFlag: 0,
          ...v.extra,
        },
      ],
    });

    await sleep(4000);
  }

  console.log("\n📺 CHECK DEVICE: Did any extra field combination produce a visible image?");
}

// ─── Main ───────────────────────────────────────────────────

const TEST_MAP: Record<string, () => Promise<void>> = {
  background: testBackground,
  "bg-stripes": testBackgroundStripes,
  "field-names": testFieldNames,
  "pixoo-api": testPixooApi,
  "numeric-type": testNumericType,
  base64: testBase64,
  "bg-base64": testBackgroundBase64,
  "extra-fields": testExtraFields,
};

async function runAll() {
  const tests = [
    "bg-stripes",
    "background",
    "extra-fields",
    "field-names",
    "pixoo-api",
    "numeric-type",
    "base64",
    "bg-base64",
  ];

  for (const name of tests) {
    await TEST_MAP[name]();
    console.log(`\n⏳ Pausing 5s before next test...`);
    await sleep(5000);
  }

  console.log("\n" + "=".repeat(60));
  console.log("ALL TESTS COMPLETE");
  console.log("=".repeat(60));
}

async function main() {
  const testName = process.argv[2] ?? "all";

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Divoom TimesFrame Protocol Probe                   ║");
  console.log("║  Systematic Image rendering fuzzing                 ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`Device: ${DEVICE_URL}`);
  console.log(`Test image: ${TEST_IMAGE_URL}`);
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
