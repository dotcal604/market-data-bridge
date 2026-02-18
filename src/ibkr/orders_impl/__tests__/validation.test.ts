import { describe, expect, it, vi } from "vitest";
import { validateOrder } from "../validation.js";
import type { PlaceOrderParams } from "../types.js";
import { logOrder } from "../../../logging.js";

vi.mock("../../../logging.js", () => ({
  logOrder: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

describe("orders_impl/validation", () => {
  it("accepts a valid MKT order", () => {
    const params: PlaceOrderParams = {
      symbol: "AAPL",
      action: "BUY",
      orderType: "MKT",
      totalQuantity: 100,
    };

    expect(validateOrder(params)).toEqual({ valid: true, errors: [] });
  });

  it("requires lmtPrice for LMT orders", () => {
    const result = validateOrder({ symbol: "AAPL", action: "BUY", orderType: "LMT", totalQuantity: 10 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("LMT requires lmtPrice");
  });

  it("requires auxPrice for STP orders", () => {
    const result = validateOrder({ symbol: "AAPL", action: "SELL", orderType: "STP", totalQuantity: 10 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("STP requires auxPrice (stop trigger price)");
  });

  it("requires trailingPercent or auxPrice for TRAIL orders", () => {
    const result = validateOrder({ symbol: "AAPL", action: "SELL", orderType: "TRAIL", totalQuantity: 10 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("TRAIL requires auxPrice (trailing amount) or trailingPercent");
  });

  it("rejects TRAIL when auxPrice and trailingPercent are both set", () => {
    const result = validateOrder({
      symbol: "AAPL",
      action: "SELL",
      orderType: "TRAIL",
      totalQuantity: 10,
      auxPrice: 1,
      trailingPercent: 2,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("TRAIL: specify auxPrice OR trailingPercent, not both");
  });

  it("rejects negative quantity", () => {
    const result = validateOrder({ symbol: "AAPL", action: "BUY", orderType: "MKT", totalQuantity: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("totalQuantity must be positive");
  });

  it("rejects missing symbol", () => {
    const result = validateOrder({ symbol: "", action: "BUY", orderType: "MKT", totalQuantity: 10 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("symbol is required");
  });

  it("warns but does not reject unknown order type", () => {
    const result = validateOrder({ symbol: "AAPL", action: "BUY", orderType: "FUTURE MAGIC", totalQuantity: 10 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(logOrder.warn).toHaveBeenCalledWith(
      { orderType: "FUTURE MAGIC" },
      "Unknown order type — passing through to IBKR",
    );
  });

  it("rejects invalid ocaType", () => {
    const result = validateOrder({
      symbol: "AAPL",
      action: "BUY",
      orderType: "MKT",
      totalQuantity: 10,
      ocaType: 4,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("ocaType must be 1 (cancel w/ block), 2 (reduce w/ block), or 3 (reduce non-block)");
  });
});
