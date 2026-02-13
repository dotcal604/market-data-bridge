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
