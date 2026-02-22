/**
 * Shared color utilities for frontend and CLI tools.
 * Returns semantic color names that can be mapped to Tailwind classes (frontend) or ANSI codes (CLI).
 */

export type ColorName = 'emerald' | 'green' | 'yellow' | 'orange' | 'red' | 'neutral' | 'muted';

/** Map a 0-10 trade score to a semantic color */
export function getScoreColorName(score: number): ColorName {
  if (score >= 8) return 'emerald';
  if (score >= 6) return 'green';
  if (score >= 4) return 'yellow';
  if (score >= 2) return 'orange';
  return 'red';
}

/** Map confidence (0-1) to a semantic color */
export function getConfidenceColorName(confidence: number): ColorName {
  if (confidence >= 0.8) return 'emerald';
  if (confidence >= 0.6) return 'green';
  if (confidence >= 0.4) return 'yellow';
  return 'red';
}

/** Map R-multiple to a semantic color */
export function getRMultipleColorName(r: number | null): ColorName {
  if (r == null) return 'muted';
  if (r >= 2) return 'emerald';
  if (r >= 1) return 'green';
  if (r >= 0) return 'yellow';
  if (r >= -1) return 'orange';
  return 'red';
}

/** Map direction to a semantic color */
export function getDirectionColorName(direction: string): ColorName {
  return direction === 'long' ? 'emerald' : 'red';
}

/** Map P&L value to a semantic color */
export function getPnlColorName(value: number | null): ColorName {
  if (value == null) return 'muted';
  if (value > 0) return 'emerald';
  if (value < 0) return 'red';
  return 'muted';
}

/** Model ID to hex color */
export const MODEL_COLORS: Record<string, string> = {
  "gpt-4o": "#10b981",
  "claude-sonnet": "#8b5cf6",
  "gemini-flash": "#f59e0b",
};

export function getModelColorHex(modelId: string): string {
  return MODEL_COLORS[modelId] ?? "#6b7280";
}

/** Recharts-friendly model colors */
export const CHART_MODEL_COLORS = ["#10b981", "#8b5cf6", "#f59e0b"];
