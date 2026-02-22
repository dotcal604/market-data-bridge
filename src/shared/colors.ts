/**
 * Shared color utilities for trade scores and metrics
 * Used by both frontend and CLI tools
 */

/** Map a 0-10 trade score to a CSS class for badges/text */
export function scoreColor(score: number): string {
  if (score >= 8) return "text-emerald-400";
  if (score >= 6) return "text-green-400";
  if (score >= 4) return "text-yellow-400";
  if (score >= 2) return "text-orange-400";
  return "text-red-400";
}

export function scoreBg(score: number): string {
  if (score >= 8) return "bg-emerald-400/15 text-emerald-400 border-emerald-400/30";
  if (score >= 6) return "bg-green-400/15 text-green-400 border-green-400/30";
  if (score >= 4) return "bg-yellow-400/15 text-yellow-400 border-yellow-400/30";
  if (score >= 2) return "bg-orange-400/15 text-orange-400 border-orange-400/30";
  return "bg-red-400/15 text-red-400 border-red-400/30";
}

export function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "text-emerald-400";
  if (confidence >= 0.6) return "text-green-400";
  if (confidence >= 0.4) return "text-yellow-400";
  return "text-red-400";
}

export function rMultipleColor(r: number | null): string {
  if (r == null) return "text-muted-foreground";
  if (r >= 2) return "text-emerald-400";
  if (r >= 1) return "text-green-400";
  if (r >= 0) return "text-yellow-400";
  if (r >= -1) return "text-orange-400";
  return "text-red-400";
}

export function directionColor(direction: string): string {
  return direction === "long" ? "text-emerald-400" : "text-red-400";
}

export function directionBg(direction: string): string {
  return direction === "long"
    ? "bg-emerald-400/15 text-emerald-400 border-emerald-400/30"
    : "bg-red-400/15 text-red-400 border-red-400/30";
}

/** Model ID to display color */
const MODEL_COLORS: Record<string, string> = {
  "gpt-4o": "#10b981",
  "claude-sonnet": "#8b5cf6",
  "gemini-flash": "#f59e0b",
};

export function modelColor(modelId: string): string {
  return MODEL_COLORS[modelId] ?? "#6b7280";
}

/** P&L value color — positive = emerald, negative = red */
export function pnlColor(value: number | null): string {
  if (value == null) return "text-muted-foreground";
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-muted-foreground";
}

/** Recharts-friendly model colors */
export const CHART_MODEL_COLORS = ["#10b981", "#8b5cf6", "#f59e0b"];
