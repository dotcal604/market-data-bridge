/**
 * Estimate float rotation (volume / float).
 * Uses market cap and price to estimate float (assuming 80% float).
 * @param volume Current volume
 * @param marketCap Market capitalization
 * @param last Current price
 * @returns Float rotation ratio
 */
export function computeFloatRotation(
  volume: number,
  marketCap: number | null,
  last: number,
): number {
  if (!marketCap || marketCap <= 0 || last <= 0 || volume <= 0) return 0;
  const estimatedShares = marketCap / last;
  const estimatedFloat = estimatedShares * 0.8;
  if (estimatedFloat <= 0) return 0;
  return Math.round((volume / estimatedFloat) * 1000) / 1000;
}
