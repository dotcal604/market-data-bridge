import { z } from "zod";

const numericPreprocess = (value: unknown): unknown => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return value;
    }

    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? value : parsed;
  }

  return value;
};

/**
 * Zod schema for a Holly alert CSV row.
 */
export const HollyAlertSchema = z.object({
  Date: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "Invalid date format (MM/DD/YYYY)"),
  Time: z.string().regex(/^\d{2}:\d{2}:\d{2}$/, "Invalid time format (HH:MM:SS)"),
  Symbol: z.string().min(1, "Symbol is required"),
  Strategy: z.string().min(1, "Strategy is required"),
  Price: z.preprocess(numericPreprocess, z.number().positive()),
  Volume: z.preprocess(numericPreprocess, z.number().int().positive()),
  Float: z
    .preprocess(numericPreprocess, z.number().int().positive())
    .optional(),
  ShortFloat: z
    .preprocess(numericPreprocess, z.number().min(0).max(100))
    .optional(),
  RelativeVolume: z.preprocess(numericPreprocess, z.number().min(0).max(100)),
  ATR: z.preprocess(numericPreprocess, z.number().positive()),
});

export interface HollyAlert {
  readonly Date: string;
  readonly Time: string;
  readonly Symbol: string;
  readonly Strategy: string;
  readonly Price: number;
  readonly Volume: number;
  readonly Float?: number;
  readonly ShortFloat?: number;
  readonly RelativeVolume: number;
  readonly ATR: number;
}

/**
 * Parse a CSV row object from the Holly alert feed into a validated shape.
 */
export function parseHollyAlertRow(row: Record<string, unknown>): HollyAlert {
  return HollyAlertSchema.parse(row);
}
