import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateOrder,
  placeAdvancedBracket,
  modifyOrder,
  type PlaceOrderParams,
  type AdvancedBracketParams,
  type ModifyOrderParams,
} from "../orders.js";

// Mock the IBKR connection and database
vi.mock("../connection.js", () => ({
  getIB: vi.fn(() => ({
    placeOrder: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    reqIds: vi.fn(),
  })),
  getNextReqId: vi.fn(() => 1),
}));

vi.mock("../../db/database.js", () => ({
  generateCorrelationId: vi.fn(() => "test-correlation-id"),
  insertOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
  insertExecution: vi.fn(),
  updateExecutionCommission: vi.fn(),
  getOrderByOrderId: vi.fn(),
}));

vi.mock("../../logging.js", () => {
  const mockChild = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: mockChild,
  });
  return {
    logOrder: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    logExec: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: mockChild,
    },
  };
});

describe("Order Validation and Advanced Brackets", () => {
  describe("validateOrder()", () => {
    describe("Required Fields", () => {
      it("should reject orders with missing symbol", () => {
        const params: PlaceOrderParams = {
          symbol: "",
          action: "BUY",
          orderType: "MKT",
          totalQuantity: 100,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("symbol is required");
      });

      it("should reject orders with invalid action (not BUY/SELL)", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "HOLD",
          orderType: "MKT",
          totalQuantity: 100,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("action must be BUY or SELL");
      });

      it("should reject orders with zero quantity", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "MKT",
          totalQuantity: 0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("totalQuantity must be positive");
      });

      it("should reject orders with negative quantity", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "MKT",
          totalQuantity: -10,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("totalQuantity must be positive");
      });
    });

    describe("LMT Order Validation", () => {
      it("should reject LMT orders without lmtPrice", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "LMT",
          totalQuantity: 100,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("LMT requires lmtPrice");
      });

      it("should accept LMT orders with lmtPrice", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "LMT",
          totalQuantity: 100,
          lmtPrice: 150.0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe("STP Order Validation", () => {
      it("should reject STP orders without auxPrice", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "SELL",
          orderType: "STP",
          totalQuantity: 100,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("STP requires auxPrice (stop trigger price)");
      });

      it("should accept STP orders with auxPrice", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "SELL",
          orderType: "STP",
          totalQuantity: 100,
          auxPrice: 145.0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe("STP LMT Order Validation", () => {
      it("should reject STP LMT orders without auxPrice", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "SELL",
          orderType: "STP LMT",
          totalQuantity: 100,
          lmtPrice: 145.0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("STP LMT requires auxPrice (stop trigger price)");
      });

      it("should reject STP LMT orders without lmtPrice", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "SELL",
          orderType: "STP LMT",
          totalQuantity: 100,
          auxPrice: 145.0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("STP LMT requires lmtPrice");
      });

      it("should accept STP LMT orders with both auxPrice and lmtPrice", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "SELL",
          orderType: "STP LMT",
          totalQuantity: 100,
          auxPrice: 145.0,
          lmtPrice: 144.0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe("TRAIL Order Validation", () => {
      it("should reject TRAIL orders with neither auxPrice nor trailingPercent", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "SELL",
          orderType: "TRAIL",
          totalQuantity: 100,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          "TRAIL requires auxPrice (trailing amount) or trailingPercent"
        );
      });

      it("should reject TRAIL orders with BOTH auxPrice and trailingPercent", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "SELL",
          orderType: "TRAIL",
          totalQuantity: 100,
          auxPrice: 5.0,
          trailingPercent: 2.0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("TRAIL: specify auxPrice OR trailingPercent, not both");
      });

      it("should accept TRAIL orders with auxPrice only", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "SELL",
          orderType: "TRAIL",
          totalQuantity: 100,
          auxPrice: 5.0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should accept TRAIL orders with trailingPercent only", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "SELL",
          orderType: "TRAIL",
          totalQuantity: 100,
          trailingPercent: 2.0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe("TRAIL LIMIT Order Validation", () => {
      it("should reject TRAIL LIMIT orders without lmtPrice", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "SELL",
          orderType: "TRAIL LIMIT",
          totalQuantity: 100,
          auxPrice: 5.0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("TRAIL LIMIT requires lmtPrice");
      });

      it("should reject TRAIL LIMIT orders with neither auxPrice nor trailingPercent", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "SELL",
          orderType: "TRAIL LIMIT",
          totalQuantity: 100,
          lmtPrice: 145.0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          "TRAIL LIMIT requires auxPrice (trailing amount) or trailingPercent"
        );
      });

      it("should accept TRAIL LIMIT orders with auxPrice and lmtPrice", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "SELL",
          orderType: "TRAIL LIMIT",
          totalQuantity: 100,
          auxPrice: 5.0,
          lmtPrice: 145.0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe("REL Order Validation", () => {
      it("should accept REL orders with discretionaryAmt", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "REL",
          totalQuantity: 100,
          discretionaryAmt: 0.5,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should reject non-REL orders with discretionaryAmt", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "MKT",
          totalQuantity: 100,
          discretionaryAmt: 0.5,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("discretionaryAmt is only valid for REL orders");
      });
    });

    describe("Unknown Order Type", () => {
      it("should accept unknown order types with warning (not error)", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "UNKNOWN_TYPE",
          totalQuantity: 100,
        };

        const result = validateOrder(params);

        // Should be valid (warning only, not an error)
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe("MKT Order Validation", () => {
      it("should accept MKT orders with just symbol/action/quantity", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "MKT",
          totalQuantity: 100,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe("OCA Type Validation", () => {
      it("should accept valid ocaType 1", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "MKT",
          totalQuantity: 100,
          ocaType: 1,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should accept valid ocaType 2", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "MKT",
          totalQuantity: 100,
          ocaType: 2,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should accept valid ocaType 3", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "MKT",
          totalQuantity: 100,
          ocaType: 3,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should reject invalid ocaType 0", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "MKT",
          totalQuantity: 100,
          ocaType: 0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          "ocaType must be 1 (cancel w/ block), 2 (reduce w/ block), or 3 (reduce non-block)"
        );
      });

      it("should reject invalid ocaType 4", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "MKT",
          totalQuantity: 100,
          ocaType: 4,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          "ocaType must be 1 (cancel w/ block), 2 (reduce w/ block), or 3 (reduce non-block)"
        );
      });

      it("should reject invalid ocaType 99", () => {
        const params: PlaceOrderParams = {
          symbol: "AAPL",
          action: "BUY",
          orderType: "MKT",
          totalQuantity: 100,
          ocaType: 99,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          "ocaType must be 1 (cancel w/ block), 2 (reduce w/ block), or 3 (reduce non-block)"
        );
      });
    });

    describe("Multiple Validation Errors", () => {
      it("should return all validation errors at once", () => {
        const params: PlaceOrderParams = {
          symbol: "",
          action: "INVALID",
          orderType: "LMT",
          totalQuantity: 0,
        };

        const result = validateOrder(params);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(1);
        expect(result.errors).toContain("symbol is required");
        expect(result.errors).toContain("action must be BUY or SELL");
        expect(result.errors).toContain("totalQuantity must be positive");
        expect(result.errors).toContain("LMT requires lmtPrice");
      });
    });
  });

  describe("placeAdvancedBracket()", () => {
    let mockIB: any;
    let mockGetIB: any;
    let orderIdCounter: number;

    beforeEach(async () => {
      orderIdCounter = 1000;

      // Mock placeOrder to simulate IBKR API
      mockIB = {
        placeOrder: vi.fn(),
        on: vi.fn((event: string, handler: Function) => {
          // Simulate immediate nextValidId response
          if (event === "nextValidId") {
            setTimeout(() => handler(orderIdCounter), 10);
          }
          // Simulate order status for parent order
          if (event === "orderStatus") {
            setTimeout(() => handler(orderIdCounter, "PreSubmitted"), 20);
          }
        }),
        off: vi.fn(),
        reqIds: vi.fn(),
      };

      // Mock getIB
      mockGetIB = vi.fn(() => mockIB);
      
      // Replace the mocked getIB with our test implementation
      const connectionModule = await import("../connection.js");
      vi.mocked(connectionModule.getIB).mockImplementation(mockGetIB);
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it("should create parent order with correct fields", async () => {
      const params: AdvancedBracketParams = {
        symbol: "AAPL",
        action: "BUY",
        quantity: 100,
        entry: { type: "LMT", price: 150.0 },
        takeProfit: { type: "LMT", price: 155.0 },
        stopLoss: { type: "STP", price: 145.0 },
      };

      const result = await placeAdvancedBracket(params);

      expect(mockIB.placeOrder).toHaveBeenCalledTimes(3);
      
      // Check parent order (first call)
      const parentCall = mockIB.placeOrder.mock.calls[0];
      const parentOrderId = parentCall[0];
      const parentContract = parentCall[1];
      const parentOrder = parentCall[2];

      expect(parentContract.symbol).toBe("AAPL");
      expect(parentOrder.action).toBe("BUY");
      expect(parentOrder.orderType).toBe("LMT");
      expect(parentOrder.totalQuantity).toBe(100);
      expect(parentOrder.lmtPrice).toBe(150.0);
      expect(parentOrder.transmit).toBe(false);
      expect(result.parentOrderId).toBe(parentOrderId);
    });

    it("should create TP and SL orders with OCA group", async () => {
      const params: AdvancedBracketParams = {
        symbol: "AAPL",
        action: "BUY",
        quantity: 100,
        entry: { type: "LMT", price: 150.0 },
        takeProfit: { type: "LMT", price: 155.0 },
        stopLoss: { type: "STP", price: 145.0 },
      };

      const result = await placeAdvancedBracket(params);

      // Check take profit order (second call)
      const tpCall = mockIB.placeOrder.mock.calls[1];
      const tpOrder = tpCall[2];

      expect(tpOrder.action).toBe("SELL"); // Reverse of BUY
      expect(tpOrder.orderType).toBe("LMT");
      expect(tpOrder.lmtPrice).toBe(155.0);
      expect(tpOrder.ocaGroup).toBeDefined();
      expect(tpOrder.ocaGroup).toContain("bracket_");
      expect((tpOrder as any).ocaType).toBe(1);
      expect(tpOrder.transmit).toBe(false);

      // Check stop loss order (third call)
      const slCall = mockIB.placeOrder.mock.calls[2];
      const slOrder = slCall[2];

      expect(slOrder.action).toBe("SELL"); // Reverse of BUY
      expect(slOrder.orderType).toBe("STP");
      expect(slOrder.auxPrice).toBe(145.0);
      expect(slOrder.ocaGroup).toBe(tpOrder.ocaGroup); // Same OCA group
      expect((slOrder as any).ocaType).toBe(1);
      expect(slOrder.transmit).toBe(true); // Last order transmits

      // Result should include OCA group
      expect(result.ocaGroup).toBe(tpOrder.ocaGroup);
    });

    it("should handle trailing stop with trailingPercent", async () => {
      const params: AdvancedBracketParams = {
        symbol: "AAPL",
        action: "BUY",
        quantity: 100,
        entry: { type: "MKT" },
        takeProfit: { type: "LMT", price: 155.0 },
        stopLoss: { type: "TRAIL", trailingPercent: 2.0 },
      };

      const result = await placeAdvancedBracket(params);

      // Check stop loss order has trailingPercent
      const slCall = mockIB.placeOrder.mock.calls[2];
      const slOrder = slCall[2];

      expect(slOrder.orderType).toBe("TRAIL");
      expect((slOrder as any).trailingPercent).toBe(2.0);
      expect(slOrder.auxPrice).toBeUndefined();
      expect(result.stopLoss.trailingPercent).toBe(2.0);
    });

    it("should handle trailing stop with trailingAmount (auxPrice)", async () => {
      const params: AdvancedBracketParams = {
        symbol: "AAPL",
        action: "BUY",
        quantity: 100,
        entry: { type: "MKT" },
        takeProfit: { type: "LMT", price: 155.0 },
        stopLoss: { type: "TRAIL", trailingAmount: 5.0 },
      };

      const result = await placeAdvancedBracket(params);

      // Check stop loss order has trailingAmount in auxPrice
      const slCall = mockIB.placeOrder.mock.calls[2];
      const slOrder = slCall[2];

      expect(slOrder.orderType).toBe("TRAIL");
      expect(slOrder.auxPrice).toBe(5.0);
      expect((slOrder as any).trailingPercent).toBeUndefined();
      expect(result.stopLoss.trailingAmount).toBe(5.0);
    });

    it("should handle STP LMT stop loss with both auxPrice and lmtPrice", async () => {
      const params: AdvancedBracketParams = {
        symbol: "AAPL",
        action: "BUY",
        quantity: 100,
        entry: { type: "LMT", price: 150.0 },
        takeProfit: { type: "LMT", price: 155.0 },
        stopLoss: { type: "STP LMT", price: 145.0, lmtPrice: 144.0 },
      };

      const result = await placeAdvancedBracket(params);

      // Check stop loss order has both auxPrice and lmtPrice
      const slCall = mockIB.placeOrder.mock.calls[2];
      const slOrder = slCall[2];

      expect(slOrder.orderType).toBe("STP LMT");
      expect(slOrder.auxPrice).toBe(145.0); // Stop trigger
      expect(slOrder.lmtPrice).toBe(144.0); // Limit price after trigger
      expect(result.stopLoss.type).toBe("STP LMT");
      expect(result.stopLoss.price).toBe(145.0);
    });

    it("should handle TRAIL LIMIT with lmtPrice", async () => {
      const params: AdvancedBracketParams = {
        symbol: "AAPL",
        action: "BUY",
        quantity: 100,
        entry: { type: "MKT" },
        takeProfit: { type: "LMT", price: 155.0 },
        stopLoss: { type: "TRAIL LIMIT", trailingPercent: 2.0, lmtPrice: 140.0 },
      };

      const result = await placeAdvancedBracket(params);

      // Check stop loss order
      const slCall = mockIB.placeOrder.mock.calls[2];
      const slOrder = slCall[2];

      expect(slOrder.orderType).toBe("TRAIL LIMIT");
      expect((slOrder as any).trailingPercent).toBe(2.0);
      expect(slOrder.lmtPrice).toBe(140.0);
      expect(result.stopLoss.type).toBe("TRAIL LIMIT");
    });

    it("should set parent IDs correctly on child orders", async () => {
      const params: AdvancedBracketParams = {
        symbol: "AAPL",
        action: "BUY",
        quantity: 100,
        entry: { type: "MKT" },
        takeProfit: { type: "LMT", price: 155.0 },
        stopLoss: { type: "STP", price: 145.0 },
      };

      const result = await placeAdvancedBracket(params);

      const parentOrderId = result.parentOrderId;
      
      // Check take profit order has parent ID
      const tpCall = mockIB.placeOrder.mock.calls[1];
      const tpOrder = tpCall[2];
      expect(tpOrder.parentId).toBe(parentOrderId);

      // Check stop loss order has parent ID
      const slCall = mockIB.placeOrder.mock.calls[2];
      const slOrder = slCall[2];
      expect(slOrder.parentId).toBe(parentOrderId);
    });

    it("should use correct reverse action for SELL parent order", async () => {
      const params: AdvancedBracketParams = {
        symbol: "AAPL",
        action: "SELL",
        quantity: 100,
        entry: { type: "MKT" },
        takeProfit: { type: "LMT", price: 145.0 },
        stopLoss: { type: "STP", price: 150.0 },
      };

      const result = await placeAdvancedBracket(params);

      // Parent should be SELL
      const parentCall = mockIB.placeOrder.mock.calls[0];
      const parentOrder = parentCall[2];
      expect(parentOrder.action).toBe("SELL");

      // Children should be BUY (reverse)
      const tpCall = mockIB.placeOrder.mock.calls[1];
      const tpOrder = tpCall[2];
      expect(tpOrder.action).toBe("BUY");

      const slCall = mockIB.placeOrder.mock.calls[2];
      const slOrder = slCall[2];
      expect(slOrder.action).toBe("BUY");
    });

    it("should return result with all order IDs and details", async () => {
      const params: AdvancedBracketParams = {
        symbol: "AAPL",
        action: "BUY",
        quantity: 100,
        entry: { type: "LMT", price: 150.0 },
        takeProfit: { type: "LMT", price: 155.0 },
        stopLoss: { type: "STP", price: 145.0 },
      };

      const result = await placeAdvancedBracket(params);

      expect(result).toBeDefined();
      expect(result.parentOrderId).toBeDefined();
      expect(result.takeProfitOrderId).toBe(result.parentOrderId + 1);
      expect(result.stopLossOrderId).toBe(result.parentOrderId + 2);
      expect(result.symbol).toBe("AAPL");
      expect(result.action).toBe("BUY");
      expect(result.quantity).toBe(100);
      expect(result.entry.type).toBe("LMT");
      expect(result.entry.price).toBe(150.0);
      expect(result.takeProfit.type).toBe("LMT");
      expect(result.takeProfit.price).toBe(155.0);
      expect(result.stopLoss.type).toBe("STP");
      expect(result.stopLoss.price).toBe(145.0);
      expect(result.ocaGroup).toBeDefined();
      expect(result.correlation_id).toBe("test-correlation-id");
    });
  });

  describe("modifyOrder()", () => {
    let mockIB: any;

    // Helper: set up mockIB so getOpenOrders() returns a known open order,
    // then modifyOrder's placeOrder() call triggers an orderStatus event.
    function setupMockIBForModify(openOrders: Array<{
      orderId: number; symbol: string; action: string; orderType: string;
      totalQuantity: number; lmtPrice: number | null; auxPrice: number | null;
      secType: string; exchange: string; currency: string; tif: string;
      parentId: number; ocaGroup?: string; status?: string;
    }>) {
      let openOrderHandler: Function | null = null;
      let openOrderEndHandler: Function | null = null;
      let orderStatusHandler: Function | null = null;

      mockIB = {
        placeOrder: vi.fn((_orderId: number) => {
          // Simulate orderStatus "PreSubmitted" after a short delay
          setTimeout(() => {
            if (orderStatusHandler) orderStatusHandler(_orderId, "PreSubmitted");
          }, 10);
        }),
        on: vi.fn((event: string, handler: Function) => {
          if (event === "openOrder") openOrderHandler = handler;
          if (event === "openOrderEnd") openOrderEndHandler = handler;
          if (event === "orderStatus") orderStatusHandler = handler;
        }),
        off: vi.fn(),
        reqAllOpenOrders: vi.fn(() => {
          // Deliver all open orders, then fire end
          setTimeout(() => {
            for (const o of openOrders) {
              if (openOrderHandler) {
                openOrderHandler(
                  o.orderId,
                  { symbol: o.symbol, secType: o.secType, exchange: o.exchange, currency: o.currency },
                  { action: o.action, orderType: o.orderType, totalQuantity: o.totalQuantity, lmtPrice: o.lmtPrice, auxPrice: o.auxPrice, tif: o.tif, parentId: o.parentId, ocaGroup: o.ocaGroup ?? "", account: "TEST" },
                  { status: o.status ?? "PreSubmitted" },
                );
              }
            }
            if (openOrderEndHandler) openOrderEndHandler();
          }, 5);
        }),
      };

      return mockIB;
    }

    beforeEach(async () => {
      const connectionModule = await import("../connection.js");
      const openOrder = {
        orderId: 500,
        symbol: "AAPL",
        action: "SELL",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: 155.0,
        auxPrice: null,
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        tif: "GTC",
        parentId: 499,
      };
      const ib = setupMockIBForModify([openOrder]);
      vi.mocked(connectionModule.getIB).mockImplementation(() => ib);
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it("should modify lmtPrice in-place using same orderId", async () => {
      const result = await modifyOrder({ orderId: 500, lmtPrice: 160.0 });

      expect(result.orderId).toBe(500);
      expect(result.symbol).toBe("AAPL");
      expect(result.lmtPrice).toBe(160.0);
      expect(result.modified).toContain("lmtPrice→160");
      expect(result.status).toBe("PreSubmitted");

      // Verify placeOrder was called with the SAME orderId (not a new one)
      expect(mockIB.placeOrder).toHaveBeenCalledTimes(1);
      const call = mockIB.placeOrder.mock.calls[0];
      expect(call[0]).toBe(500); // same orderId
      expect(call[2].lmtPrice).toBe(160.0);
      expect(call[2].orderId).toBe(500);
    });

    it("should preserve parentId on bracket leg modification", async () => {
      const result = await modifyOrder({ orderId: 500, lmtPrice: 158.0 });

      const call = mockIB.placeOrder.mock.calls[0];
      const order = call[2];
      expect(order.parentId).toBe(499); // preserved from open order
      expect(result.orderId).toBe(500);
    });

    it("should modify auxPrice (stop trigger)", async () => {
      // Set up an open STP order
      const connectionModule = await import("../connection.js");
      const stpOrder = {
        orderId: 501,
        symbol: "AAPL",
        action: "SELL",
        orderType: "STP",
        totalQuantity: 100,
        lmtPrice: null,
        auxPrice: 145.0,
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        tif: "GTC",
        parentId: 499,
      };
      const ib = setupMockIBForModify([stpOrder]);
      vi.mocked(connectionModule.getIB).mockImplementation(() => ib);

      const result = await modifyOrder({ orderId: 501, auxPrice: 143.0 });

      expect(result.auxPrice).toBe(143.0);
      expect(result.modified).toContain("auxPrice→143");
      const call = mockIB.placeOrder.mock.calls[0];
      expect(call[2].auxPrice).toBe(143.0);
    });

    it("should modify totalQuantity", async () => {
      const result = await modifyOrder({ orderId: 500, totalQuantity: 50 });

      expect(result.totalQuantity).toBe(50);
      expect(result.modified).toContain("totalQuantity→50");
    });

    it("should modify multiple fields at once", async () => {
      const result = await modifyOrder({
        orderId: 500,
        lmtPrice: 162.0,
        totalQuantity: 75,
        tif: "DAY",
      });

      expect(result.lmtPrice).toBe(162.0);
      expect(result.totalQuantity).toBe(75);
      expect(result.modified).toContain("lmtPrice→162");
      expect(result.modified).toContain("totalQuantity→75");
      expect(result.modified).toContain("tif→DAY");
    });

    it("should throw when no fields are provided to modify", async () => {
      await expect(modifyOrder({ orderId: 500 })).rejects.toThrow(
        "No fields to modify"
      );
    });

    it("should throw when order is not found in open orders", async () => {
      await expect(
        modifyOrder({ orderId: 9999, lmtPrice: 100 })
      ).rejects.toThrow("Order 9999 not found in open orders");
    });

    it("should preserve existing values for unmodified fields", async () => {
      const result = await modifyOrder({ orderId: 500, lmtPrice: 161.0 });

      // orderType should remain LMT (from original), not be changed
      expect(result.orderType).toBe("LMT");
      // action should remain SELL
      expect(result.action).toBe("SELL");
      // totalQuantity should remain 100
      expect(result.totalQuantity).toBe(100);

      const call = mockIB.placeOrder.mock.calls[0];
      expect(call[2].orderType).toBe("LMT");
      expect(call[2].totalQuantity).toBe(100);
      expect(call[2].tif).toBe("GTC");
    });

    it("should preserve ocaGroup on bracket leg modification", async () => {
      const connectionModule = await import("../connection.js");
      const ocaOrder = {
        orderId: 502,
        symbol: "AAPL",
        action: "SELL",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: 155.0,
        auxPrice: null,
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        tif: "GTC",
        parentId: 499,
        ocaGroup: "bracket_499_1700000000",
      };
      const ib = setupMockIBForModify([ocaOrder]);
      vi.mocked(connectionModule.getIB).mockImplementation(() => ib);

      await modifyOrder({ orderId: 502, lmtPrice: 160.0 });

      const call = mockIB.placeOrder.mock.calls[0];
      expect(call[2].ocaGroup).toBe("bracket_499_1700000000");
    });

    it("should reject negative lmtPrice", async () => {
      await expect(
        modifyOrder({ orderId: 500, lmtPrice: -100 })
      ).rejects.toThrow("lmtPrice must be non-negative");
    });

    it("should reject negative auxPrice", async () => {
      await expect(
        modifyOrder({ orderId: 500, auxPrice: -5 })
      ).rejects.toThrow("auxPrice must be non-negative");
    });

    it("should reject zero totalQuantity", async () => {
      await expect(
        modifyOrder({ orderId: 500, totalQuantity: 0 })
      ).rejects.toThrow("totalQuantity must be positive");
    });

    it("should reject modification of non-modifiable order status", async () => {
      const connectionModule = await import("../connection.js");
      const cancellingOrder = {
        orderId: 503,
        symbol: "AAPL",
        action: "SELL",
        orderType: "LMT",
        totalQuantity: 100,
        lmtPrice: 155.0,
        auxPrice: null,
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        tif: "GTC",
        parentId: 0,
        status: "PendingCancel",
      };
      const ib = setupMockIBForModify([cancellingOrder]);
      vi.mocked(connectionModule.getIB).mockImplementation(() => ib);

      await expect(
        modifyOrder({ orderId: 503, lmtPrice: 160.0 })
      ).rejects.toThrow("not modifiable (status: PendingCancel)");
    });
  });
});
