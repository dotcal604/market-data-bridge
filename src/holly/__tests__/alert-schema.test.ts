import { describe, expect, it } from "vitest";
import { HollyAlertRowSchema } from "../alert-schema.js";

describe("HollyAlertRowSchema", () => {
  it("accepts a normalized row and uppercases symbol", () => {
    const parsed = HollyAlertRowSchema.parse({
      alert_time: "2026-02-20T14:30:00Z",
      symbol: "aapl",
      strategy: "  Breakout  ",
      entry_price: 180.15,
      stop_price: null,
      shares: 500,
      last_price: 181.0,
      segment: " Large Cap ",
      extra: null,
    });

    expect(parsed.symbol).toBe("AAPL");
    expect(parsed.strategy).toBe("Breakout");
    expect(parsed.segment).toBe("Large Cap");
  });

  it("rejects empty symbol", () => {
    const parsed = HollyAlertRowSchema.safeParse({
      alert_time: "2026-02-20T14:30:00Z",
      symbol: "   ",
      strategy: null,
      entry_price: null,
      stop_price: null,
      shares: null,
      last_price: null,
      segment: null,
      extra: null,
    });

    expect(parsed.success).toBe(false);
  });
});
