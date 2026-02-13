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
