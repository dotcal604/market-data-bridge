import type { BarData } from "../types.js";

/**
 * Compute 14-period Average True Range (ATR).
 * @param bars Daily bar data
 * @param last Current price
 * @returns ATR value and ATR as percentage of price
 */
export function computeATR(bars: BarData[], last: number): { atr_14: number; atr_pct: number } {
  if (bars.length < 2) return { atr_14: 0, atr_pct: 0 };
  const period = 14;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const curr = bars[i];
    const prev = bars[i - 1];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    );
    trs.push(tr);
  }
  if (trs.length === 0) return { atr_14: 0, atr_pct: 0 };
  const recent = trs.slice(-period);
  const atr = recent.reduce((s, v) => s + v, 0) / recent.length;
  const atrPct = last > 0 ? (atr / last) * 100 : 0;
  return { atr_14: Math.round(atr * 100) / 100, atr_pct: Math.round(atrPct * 100) / 100 };
}
