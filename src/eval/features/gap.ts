export function computeGapPct(open: number, closePrev: number): number {
  if (closePrev <= 0) return 0;
  return ((open - closePrev) / closePrev) * 100;
}
