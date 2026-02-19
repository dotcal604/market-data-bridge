/**
 * Compute price extension (distance from open/close) in ATR units.
 * @param last Current price
 * @param closePrev Previous close
 * @param open Open price
 * @param atr Average True Range
 * @returns Extension in ATR units
 */
export function computePriceExtension(
  last: number,
  closePrev: number,
  open: number,
  atr: number,
): number {
  if (atr <= 0) return 0;
  const distFromClose = Math.abs(last - closePrev);
  const distFromOpen = Math.abs(last - open);
  const maxDist = Math.max(distFromClose, distFromOpen);
  return Math.round((maxDist / atr) * 100) / 100;
}
