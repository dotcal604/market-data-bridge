import { z } from "zod";

const nullableNumber = z.number().finite().nullable();

export const HollyAlertRowSchema = z.object({
  alert_time: z.string().trim().min(1),
  symbol: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  strategy: z.string().trim().min(1).nullable(),
  entry_price: nullableNumber,
  stop_price: nullableNumber,
  shares: z.number().int().nullable(),
  last_price: nullableNumber,
  segment: z.string().trim().min(1).nullable(),
  extra: z.string().nullable(),
});

export type HollyAlertRow = z.infer<typeof HollyAlertRowSchema>;
