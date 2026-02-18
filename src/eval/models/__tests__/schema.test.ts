import { describe, it, expect } from "vitest";
import { ModelOutputSchema } from "../schema.js";

const validOutput = {
  trade_score: 78,
  extension_risk: 22,
  exhaustion_risk: 31,
  float_rotation_risk: 18,
  market_alignment: 40,
  expected_rr: 2.4,
  confidence: 88,
  should_trade: true,
  reasoning: "Momentum and market alignment support continuation.",
};

describe("ModelOutputSchema", () => {
  it("accepts a valid output payload", () => {
    const parsed = ModelOutputSchema.safeParse(validOutput);
    expect(parsed.success).toBe(true);
  });

  it("rejects missing trade_score", () => {
    const payload = { ...validOutput } as Partial<typeof validOutput>;
    delete payload.trade_score;

    const parsed = ModelOutputSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("rejects trade_score below range", () => {
    const parsed = ModelOutputSchema.safeParse({ ...validOutput, trade_score: -1 });
    expect(parsed.success).toBe(false);
  });

  it("rejects trade_score above range", () => {
    const parsed = ModelOutputSchema.safeParse({ ...validOutput, trade_score: 101 });
    expect(parsed.success).toBe(false);
  });

  it("rejects market_alignment outside -100 to 100", () => {
    const parsed = ModelOutputSchema.safeParse({ ...validOutput, market_alignment: 101 });
    expect(parsed.success).toBe(false);
  });

  it("rejects negative expected_rr", () => {
    const parsed = ModelOutputSchema.safeParse({ ...validOutput, expected_rr: -0.01 });
    expect(parsed.success).toBe(false);
  });

  it("rejects confidence above range", () => {
    const parsed = ModelOutputSchema.safeParse({ ...validOutput, confidence: 101 });
    expect(parsed.success).toBe(false);
  });

  it("rejects reasoning longer than 500 chars", () => {
    const parsed = ModelOutputSchema.safeParse({ ...validOutput, reasoning: "x".repeat(501) });
    expect(parsed.success).toBe(false);
  });

  it("strips unknown extra fields", () => {
    const parsed = ModelOutputSchema.parse({ ...validOutput, leaked_field: "should not remain" });

    expect(parsed).toEqual(validOutput);
    expect("leaked_field" in parsed).toBe(false);
  });
});
