export function computeSpreadPct(bid: number | null, ask: number | null, last: number): number {
  if (bid == null || ask == null || last <= 0) return 0;
  if (bid <= 0 || ask <= 0) return 0;
  return ((ask - bid) / last) * 100;
}
