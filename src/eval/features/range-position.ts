export function computeRangePositionPct(last: number, high: number, low: number): number {
  const range = high - low;
  if (range <= 0) return 50;
  return ((last - low) / range) * 100;
}
