/**
 * Divoom TimesFrame — Font & Glyph Probe
 *
 * Sends 6 Text elements with different FontIDs to the device,
 * each showing the same Unicode test string. Look at the glass
 * to see which FontID renders what glyphs.
 *
 * Usage:
 *   npx tsx src/divoom/probe-fonts.ts           # FontIDs 0–5
 *   npx tsx src/divoom/probe-fonts.ts 50        # FontIDs 50–55
 *   npx tsx src/divoom/probe-fonts.ts 52 blocks # just FontID 52, Unicode blocks test
 *   npx tsx src/divoom/probe-fonts.ts sweep     # cycle through 0–255 in batches of 6
 */

const DEVICE_IP = "192.168.0.48";
const DEVICE_PORT = 9000;
const DEVICE_URL = `http://${DEVICE_IP}:${DEVICE_PORT}/divoom_api`;

// ─── Test Strings ────────────────────────────────────────────

const TEST_STRINGS: Record<string, string> = {
  // Default: mix of everything
  mix:    "Aa1 ▁▂▃▄▅▆▇█ ←→↑↓ ●○■□",
  // Pure Unicode block elements (the sparkline chars)
  blocks: "▁▂▃▄▅▆▇█ ▁▃▅▇█▇▅▃▁ Lo Hi",
  // Box-drawing for borders/dividers
  box:    "─│┌┐└┘├┤┬┴┼ ═║╔╗╚╝",
  // Arrows and indicators
  arrows: "← → ↑ ↓ ▲ ▼ ◀ ▶ ⬆ ⬇",
  // Math and currency
  math:   "+−×÷ ≤≥≠≈ $€£¥ %‰",
  // Misc useful symbols
  symbols:"● ○ ◉ ■ □ ▪ ★ ☆ ◆ ◇ ♦",
  // ASCII sparkline (known working baseline)
  ascii:  "_.:;=+o# SPY __.::;;==++oo##",
  // Braille (known broken — but let's confirm per font)
  braille:"⠀⠁⠂⠃⠄⠅⠆⠇⡀⡁⡂⡃⡄⡅⡆⡇",
  // Full block + shade chars
  shades: "░▒▓█ ░░▒▒▓▓██ light→dark",
};

// ─── Helpers ─────────────────────────────────────────────────

async function sendCommand(command: string, payload: Record<string, unknown> = {}): Promise<any> {
  const body = { Command: command, ...payload };
  try {
    const response = await fetch(DEVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    return data;
  } catch (err: any) {
    console.error(`  ✗ Error: ${err.message}`);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Probe: Show 6 FontIDs at once ──────────────────────────

async function probeRange(startId: number, testKey = "mix") {
  const testStr = TEST_STRINGS[testKey] ?? TEST_STRINGS.mix;
  const count = Math.min(6, 256 - startId); // device max 6 Text elements

  console.log(`\n${"=".repeat(60)}`);
  console.log(`FONT PROBE: FontID ${startId}–${startId + count - 1}`);
  console.log(`Test string (${testKey}): ${testStr}`);
  console.log(`${"=".repeat(60)}`);

  const elements = [];
  const rowH = Math.floor(1280 / count); // evenly divide canvas

  for (let i = 0; i < count; i++) {
    const fontId = startId + i;
    const y = i * rowH;
    // Label + test string
    const text = `F${fontId}: ${testStr}`;

    elements.push({
      ID: i + 1,
      Type: "Text",
      StartX: 16,
      StartY: y,
      Width: 768,
      Height: rowH,
      Align: 0,
      FontSize: 36,
      FontID: fontId,
      FontColor: "#00FF00",
      BgColor: "#00000000",
      TextMessage: text,
    });

    console.log(`  Element ${i + 1}: FontID=${fontId}, Y=${y}, H=${rowH}`);
  }

  const result = await sendCommand("Device/EnterCustomControlMode", {
    DispList: elements,
  });

  if (result?.ReturnCode === 0) {
    console.log(`\n✓ Sent ${count} elements. Check the device!`);
  } else {
    console.log(`\n✗ Device returned:`, result);
  }
}

// ─── Probe: Single FontID with all test strings ─────────────

async function probeSingleFont(fontId: number) {
  // Pick the 6 most useful test strings
  const tests = ["mix", "blocks", "shades", "arrows", "box", "symbols"];

  console.log(`\n${"=".repeat(60)}`);
  console.log(`GLYPH PROBE: FontID ${fontId} — all glyph categories`);
  console.log(`${"=".repeat(60)}`);

  const elements = [];
  const rowH = Math.floor(1280 / tests.length);

  for (let i = 0; i < tests.length; i++) {
    const key = tests[i];
    const testStr = TEST_STRINGS[key];
    const y = i * rowH;

    elements.push({
      ID: i + 1,
      Type: "Text",
      StartX: 16,
      StartY: y,
      Width: 768,
      Height: rowH,
      Align: 0,
      FontSize: 30,
      FontID: fontId,
      FontColor: i % 2 === 0 ? "#00FF00" : "#00CCFF",
      BgColor: "#00000000",
      TextMessage: `${key}: ${testStr}`,
    });

    console.log(`  [${key}] ${testStr}`);
  }

  const result = await sendCommand("Device/EnterCustomControlMode", {
    DispList: elements,
  });

  if (result?.ReturnCode === 0) {
    console.log(`\n✓ Sent 6 glyph tests for FontID ${fontId}. Check the device!`);
  } else {
    console.log(`\n✗ Device returned:`, result);
  }
}

// ─── Probe: Sweep all FontIDs in batches ────────────────────

async function sweep() {
  console.log("\nSWEEP MODE: cycling FontIDs 0–255 in batches of 6");
  console.log("Each batch displays for 6 seconds. Watch the device!\n");

  for (let start = 0; start < 256; start += 6) {
    await probeRange(start, "blocks");
    console.log("  ⏳ Waiting 6s...\n");
    await sleep(6000);
  }

  console.log("\n✓ Sweep complete!");
}

// ─── CLI Entry ───────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "sweep") {
    await sweep();
    return;
  }

  if (args.length === 0) {
    // Default: FontIDs 0–5 with mix
    await probeRange(0);
    return;
  }

  const startId = parseInt(args[0], 10);
  if (isNaN(startId) || startId < 0 || startId > 255) {
    console.error("Usage: npx tsx src/divoom/probe-fonts.ts [0-255] [test-key]");
    console.error("       npx tsx src/divoom/probe-fonts.ts sweep");
    console.error(`Test keys: ${Object.keys(TEST_STRINGS).join(", ")}`);
    process.exit(1);
  }

  // Single font with all glyph tests
  if (args[1] === "blocks" || args[1] === "all") {
    await probeSingleFont(startId);
    return;
  }

  // Range of 6 fonts with specific test string
  await probeRange(startId, args[1]);
}

main().catch(console.error);
