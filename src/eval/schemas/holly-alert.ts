import { z } from "zod";

const DATE_MM_DD_YYYY = /^(0[1-9]|1[0-2])\/(0[1-9]|[12][0-9]|3[01])\/\d{4}$/;
const TIME_HH_MM_SS = /^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;

const optionalPositiveIntegerFromCsv = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z.coerce.number().int("Value must be an integer").positive("Value must be positive").optional(),
);

const optionalPercentageFromCsv = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z.coerce
    .number()
    .min(0, "Value must be between 0 and 100")
    .max(100, "Value must be between 0 and 100")
    .optional(),
);

/**
 * Zod schema for a single Holly alert CSV row.
 */
export const HollyAlertSchema = z.object({
  Date: z.string().regex(DATE_MM_DD_YYYY, "Date must be in MM/DD/YYYY format"),
  Time: z.string().regex(TIME_HH_MM_SS, "Time must be in HH:MM:SS format"),
  Symbol: z.string().min(1, "Symbol is required"),
  Strategy: z.string().min(1, "Strategy is required"),
  Price: z.coerce.number().positive("Price must be a positive number"),
  Volume: z.coerce.number().int("Volume must be an integer").positive("Volume must be positive"),
  Float: optionalPositiveIntegerFromCsv,
  ShortFloat: optionalPercentageFromCsv,
  RelativeVolume: z.coerce
    .number()
    .min(0, "RelativeVolume must be between 0 and 100")
    .max(100, "RelativeVolume must be between 0 and 100"),
  ATR: z.coerce.number().positive("ATR must be a positive number"),
});

/**
 * Parsed and validated Holly alert CSV row.
 */
export type HollyAlert = z.infer<typeof HollyAlertSchema>;

/**
 * Parse and validate a Holly alert CSV row object.
 */
export function parseHollyAlertRow(row: Record<string, string>): HollyAlert {
  return HollyAlertSchema.parse(row);
}
