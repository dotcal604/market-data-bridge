import {
  getScoreColorName,
  getConfidenceColorName,
  getRMultipleColorName,
  getDirectionColorName,
  getPnlColorName,
  getModelColorHex,
  CHART_MODEL_COLORS as SHARED_CHART_MODEL_COLORS,
  ColorName
} from "@shared/colors";

const TEXT_COLORS: Record<ColorName, string> = {
  emerald: "text-emerald-400",
  green: "text-green-400",
  yellow: "text-yellow-400",
  orange: "text-orange-400",
  red: "text-red-400",
  muted: "text-muted-foreground",
  neutral: "text-gray-400"
};

const BG_COLORS: Record<ColorName, string> = {
  emerald: "bg-emerald-400/15 text-emerald-400 border-emerald-400/30",
  green: "bg-green-400/15 text-green-400 border-green-400/30",
  yellow: "bg-yellow-400/15 text-yellow-400 border-yellow-400/30",
  orange: "bg-orange-400/15 text-orange-400 border-orange-400/30",
  red: "bg-red-400/15 text-red-400 border-red-400/30",
  muted: "bg-muted/15 text-muted-foreground border-muted/30",
  neutral: "bg-gray-400/15 text-gray-400 border-gray-400/30"
};

/** Map a 0-10 trade score to a CSS class for badges/text */
export function scoreColor(score: number): string {
  const colorName = getScoreColorName(score);
  return TEXT_COLORS[colorName];
}

export function scoreBg(score: number): string {
  const colorName = getScoreColorName(score);
  return BG_COLORS[colorName];
}

export function confidenceColor(confidence: number): string {
  const colorName = getConfidenceColorName(confidence);
  return TEXT_COLORS[colorName];
}

export function rMultipleColor(r: number | null): string {
  const colorName = getRMultipleColorName(r);
  return TEXT_COLORS[colorName];
}

export function directionColor(direction: string): string {
  const colorName = getDirectionColorName(direction);
  return TEXT_COLORS[colorName];
}

export function directionBg(direction: string): string {
  const colorName = getDirectionColorName(direction);
  return BG_COLORS[colorName];
}

export function modelColor(modelId: string): string {
  return getModelColorHex(modelId);
}

/** P&L value color — positive = emerald, negative = red */
export function pnlColor(value: number | null): string {
  const colorName = getPnlColorName(value);
  return TEXT_COLORS[colorName];
}

/** Recharts-friendly model colors */
export const CHART_MODEL_COLORS = SHARED_CHART_MODEL_COLORS;
