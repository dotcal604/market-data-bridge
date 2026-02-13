import type { BarData } from "../types.js";

export function computeVolumeAcceleration(intradayBars: BarData[]): number {
  if (intradayBars.length < 2) return 1;
  const last = intradayBars[intradayBars.length - 1];
  const prev = intradayBars[intradayBars.length - 2];
  if (prev.volume <= 0) return last.volume > 0 ? 10 : 1;
  return Math.round((last.volume / prev.volume) * 100) / 100;
}
