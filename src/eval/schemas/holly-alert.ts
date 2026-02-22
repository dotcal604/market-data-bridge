import { z } from "zod";

const MM_DD_YYYY_DATE_REGEX = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;
const HH_MM_SS_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

const optionalCsvNumber = (schema: z.ZodNumber) =>
  z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) {
      return undefined;
    }

    return value;
  }, z.coerce.number().pipe(schema).optional());

/**
 * Zod schema for one Holly alert CSV row.
 */
export const hollyAlertSchema = z.object({
  /** Date in MM/DD/YYYY format. */
  Date: z.string().regex(MM_DD_YYYY_DATE_REGEX, "Date must be MM/DD/YYYY"),

  /** Time in HH:MM:SS format (24-hour clock). */
  Time: z.string().regex(HH_MM_SS_TIME_REGEX, "Time must be HH:MM:SS"),

  /** Stock ticker symbol. */
  Symbol: z.string().min(1),

  /** Holly strategy name. */
  Strategy: z.string().min(1),

  /** Alert price; must be a positive number. */
  Price: z.coerce.number().positive(),

  /** Alert volume; must be a positive integer. */
  Volume: z.coerce.number().int().positive(),

  /** Estimated float; optional positive integer. */
  Float: optionalCsvNumber(z.number().int().positive()),

  /** Short float percentage; optional value from 0 to 100. */
  ShortFloat: optionalCsvNumber(z.number().min(0).max(100)),

  /** Relative volume percentage; required value from 0 to 100. */
  RelativeVolume: z.coerce.number().min(0).max(100),

  /** Average true range; must be a positive number. */
  ATR: z.coerce.number().positive(),
});

export type HollyAlert = z.infer<typeof hollyAlertSchema>;

/**
 * Validates and parses one Holly alert CSV row object.
 */
export const parseHollyAlert = (row: Record<string, unknown>): HollyAlert => hollyAlertSchema.parse(row);
