/**
 * Canvas Background — Solid Black JPEG
 *
 * Serves a solid-black 800×1280 JPEG via BackgroudImageAddr to eliminate
 * the TimesFrame's default cyan canvas color.
 *
 * On the 10.1" transparent IPS panel:
 *   - Black pixels = fully transparent (see-through glass)
 *   - The solid black background makes Text elements float on glass
 *
 * BackgroudImageAddr is the ONLY working image rendering path on TimesFrame.
 * Image elements in DispList (Type "Image") are non-functional — the device
 * fetches their URLs via curl but never decodes or displays the content.
 *
 * The rendered buffer is cached indefinitely (solid black never changes).
 */

import sharp from "sharp";
import { logger } from "../logging.js";

const log = logger.child({ module: "divoom-background" });

const W = 800;
const H = 1280;

let cachedBuffer: Buffer | null = null;

/**
 * Generate a solid-black 800×1280 JPEG buffer.
 * Cached after first render (~6KB output).
 */
export async function renderHudBackground(): Promise<Buffer> {
  if (cachedBuffer) return cachedBuffer;

  const t0 = Date.now();

  // Sharp can create a solid-color image directly — no canvas needed
  const jpegBuf = await sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();

  cachedBuffer = jpegBuf;
  log.info({ size: jpegBuf.length, ms: Date.now() - t0 }, "Black background rendered");

  return jpegBuf;
}

/** Clear cached background */
export function clearBackgroundCache(): void {
  cachedBuffer = null;
}
