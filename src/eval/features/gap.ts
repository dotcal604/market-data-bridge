/**
 * Compute opening gap percentage.
 * @param open Open price
 * @param closePrev Previous close price
 * @returns Gap percentage
 */
export function computeGapPct(open: number, closePrev: number): number {
  if (closePrev <= 0) return 0;
  return ((open - closePrev) / closePrev) * 100;
}
