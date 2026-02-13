export type VolatilityRegime = "low" | "normal" | "high";

export function classifyVolatilityRegime(atrPct: number): VolatilityRegime {
  if (atrPct < 2) return "low";
  if (atrPct <= 5) return "normal";
  return "high";
}
