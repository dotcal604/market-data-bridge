/**
 * Compute position within day's range (0-100%).
 * @param last Current price
 * @param high Day's high
 * @param low Day's low
 * @returns Percentage (0 = low, 100 = high)
 */
export function computeRangePositionPct(last: number, high: number, low: number): number {
  const range = high - low;
  if (range <= 0) return 50;
  return ((last - low) / range) * 100;
}
