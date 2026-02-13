import { z } from "zod";

export const ModelOutputSchema = z.object({
  trade_score: z.number().min(0).max(100),
  extension_risk: z.number().min(0).max(100),
  exhaustion_risk: z.number().min(0).max(100),
  float_rotation_risk: z.number().min(0).max(100),
  market_alignment: z.number().min(-100).max(100),
  expected_rr: z.number().min(0),
  confidence: z.number().min(0).max(100),
  should_trade: z.boolean(),
  reasoning: z.string().max(500),
});

export type ValidatedModelOutput = z.infer<typeof ModelOutputSchema>;
