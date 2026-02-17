/**
 * Tests for Trailing Stop Executor
 *
 * Integration tests for live trailing stop order management via IBKR.
 * Mocks the IBKR API to verify stop price calculations, order modifications,
 * and edge case handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Order, Contract } from "@stoqey/ib";

// ── Mock IBKR connection ─────────────────────────────────────────────────

let mockPlaceOrder: ReturnType<typeof vi.fn>;
let mockOn: ReturnType<typeof vi.fn>;
let mockOff: ReturnType<typeof vi.fn>;

vi.mock("../../ibkr/connection.js", () => ({
  getIB: vi.fn(() => ({
    placeOrder: mockPlaceOrder,
    on: mockOn,
    off: mockOff,
    reqIds: vi.fn(),
  })),
  getNextReqId: vi.fn(() => 1),
}));

// Mock getOpenOrders to return test order data
let mockOpenOrders: Array<{
  orderId: number;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  action: string;
  orderType: string;
  totalQuantity: number;
  lmtPrice: number | null;
  auxPrice: number | null;
  status: string;
  remaining: number;
  tif: string;
  parentId: number;
  ocaGroup: string;
  account: string;
}> = [];

vi.mock("../../ibkr/orders.js", () => ({
  getOpenOrders: vi.fn(() => Promise.resolve(mockOpenOrders)),
}));

// Mock database
vi.mock("../../db/database.js", () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(),
    exec: vi.fn(),
  })),
}));

// Mock logger
vi.mock("../../logging.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Import after mocks
import {
  calculateTrailingStop,
  modifyStopOrder,
  updatePosition,
  removePosition,
  processTrailingStops,
  startExecutor,
  stopExecutor,
  getExecutorState,
  resetExecutor,
  type TrailingStopConfig,
  type PositionState,
} from "../trailing-stop-executor.js";

// ── Test Setup ───────────────────────────────────────────────────────────

describe("Trailing Stop Executor", () => {
  beforeEach(() => {
    // Reset mocks
    mockPlaceOrder = vi.fn();
    mockOn = vi.fn();
    mockOff = vi.fn();
    mockOpenOrders = [];
    
    // Reset executor state
    resetExecutor();
    
    // Re-setup mocks (vi.mock hoisting requires this pattern)
    const { getIB } = require("../../ibkr/connection.js");
    getIB.mockReturnValue({
      placeOrder: mockPlaceOrder,
      on: mockOn,
      off: mockOff,
      reqIds: vi.fn(),
    });
    
    const { getOpenOrders } = require("../../ibkr/orders.js");
    getOpenOrders.mockResolvedValue(mockOpenOrders);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Stop Price Calculations ────────────────────────────────────────────

  describe("calculateTrailingStop()", () => {
    describe("Fixed Percentage Trailing", () => {
      it("should calculate stop price for long position with 2% trail", () => {
        const position: PositionState = {
          symbol: "AAPL",
          quantity: 100,
          avgCost: 150.0,
          currentPrice: 155.0,
          unrealizedPnL: 500.0,
          highWaterMark: 155.0,
          breakevenTriggered: false,
        };

        const config: TrailingStopConfig = {
          type: "fixed_pct",
          trail_pct: 2.0,
        };

        const stopPrice = calculateTrailingStop(position, config);
        
        expect(stopPrice).toBe(151.9); // 155 - (155 * 0.02) = 151.9
      });

      it("should calculate stop price for short position with 2% trail", () => {
        const position: PositionState = {
          symbol: "TSLA",
          quantity: -100,
          avgCost: 200.0,
          currentPrice: 195.0,
          unrealizedPnL: 500.0,
          highWaterMark: 195.0, // lowest for short
          breakevenTriggered: false,
        };

        const config: TrailingStopConfig = {
          type: "fixed_pct",
          trail_pct: 2.0,
        };

        const stopPrice = calculateTrailingStop(position, config);
        
        expect(stopPrice).toBe(198.9); // 195 + (195 * 0.02) = 198.9
      });

      it("should calculate stop price with 3% trail", () => {
        const position: PositionState = {
          symbol: "AAPL",
          quantity: 100,
          avgCost: 150.0,
          currentPrice: 160.0,
          unrealizedPnL: 1000.0,
          highWaterMark: 160.0,
          breakevenTriggered: false,
        };

        const config: TrailingStopConfig = {
          type: "fixed_pct",
          trail_pct: 3.0,
        };

        const stopPrice = calculateTrailingStop(position, config);
        
        expect(stopPrice).toBe(155.2); // 160 - (160 * 0.03) = 155.2
      });
    });

    describe("ATR-Based Trailing", () => {
      it("should calculate stop price using ATR multiple for long", () => {
        const position: PositionState = {
          symbol: "AAPL",
          quantity: 100,
          avgCost: 150.0,
          currentPrice: 155.0,
          unrealizedPnL: 500.0,
          highWaterMark: 155.0,
          breakevenTriggered: false,
        };

        const config: TrailingStopConfig = {
          type: "atr_multiple",
          atr_mult: 2.0,
        };

        const stopPrice = calculateTrailingStop(position, config);
        
        // ATR proxy = 150 * 0.02 = 3.0
        // Trail distance = 3.0 * 2.0 = 6.0
        // Stop = 155 - 6.0 = 149.0
        expect(stopPrice).toBe(149.0);
      });

      it("should calculate stop price using ATR multiple for short", () => {
        const position: PositionState = {
          symbol: "TSLA",
          quantity: -100,
          avgCost: 200.0,
          currentPrice: 195.0,
          unrealizedPnL: 500.0,
          highWaterMark: 195.0,
          breakevenTriggered: false,
        };

        const config: TrailingStopConfig = {
          type: "atr_multiple",
          atr_mult: 1.5,
        };

        const stopPrice = calculateTrailingStop(position, config);
        
        // ATR proxy = 200 * 0.02 = 4.0
        // Trail distance = 4.0 * 1.5 = 6.0
        // Stop = 195 + 6.0 = 201.0
        expect(stopPrice).toBe(201.0);
      });
    });

    describe("Breakeven Trailing", () => {
      it("should return avgCost when breakeven trigger hit for first time", () => {
        const position: PositionState = {
          symbol: "AAPL",
          quantity: 100,
          avgCost: 150.0,
          currentPrice: 153.0,
          unrealizedPnL: 300.0, // 1R = 150 * 100 * 0.02 = 300
          highWaterMark: 153.0,
          breakevenTriggered: false,
        };

        const config: TrailingStopConfig = {
          type: "breakeven_trail",
          be_trigger_r: 1.0,
          post_be_trail_pct: 1.0,
        };

        const stopPrice = calculateTrailingStop(position, config);
        
        expect(stopPrice).toBe(150.0); // Move to breakeven
      });

      it("should trail from high water mark after breakeven triggered", () => {
        const position: PositionState = {
          symbol: "AAPL",
          quantity: 100,
          avgCost: 150.0,
          currentPrice: 156.0,
          unrealizedPnL: 600.0, // 2R
          highWaterMark: 156.0,
          breakevenTriggered: true,
        };

        const config: TrailingStopConfig = {
          type: "breakeven_trail",
          be_trigger_r: 1.0,
          post_be_trail_pct: 1.0,
        };

        const stopPrice = calculateTrailingStop(position, config);
        
        expect(stopPrice).toBe(154.44); // 156 - (156 * 0.01) = 154.44
      });

      it("should return null when breakeven not triggered yet", () => {
        const position: PositionState = {
          symbol: "AAPL",
          quantity: 100,
          avgCost: 150.0,
          currentPrice: 151.0,
          unrealizedPnL: 100.0, // < 1R
          highWaterMark: 151.0,
          breakevenTriggered: false,
        };

        const config: TrailingStopConfig = {
          type: "breakeven_trail",
          be_trigger_r: 1.0,
          post_be_trail_pct: 1.0,
        };

        const stopPrice = calculateTrailingStop(position, config);
        
        expect(stopPrice).toBeNull();
      });
    });
  });

  // ── Order Modification Flow ─────────────────────────────────────────────

  describe("modifyStopOrder()", () => {
    it("should modify stop order with new stop price", async () => {
      mockOpenOrders = [{
        orderId: 123,
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        action: "BUY",
        orderType: "STP",
        totalQuantity: 100,
        lmtPrice: null,
        auxPrice: 148.0,
        status: "Submitted",
        remaining: 100,
        tif: "GTC",
        parentId: 0,
        ocaGroup: "OCA_123",
        account: "U1234567",
      }];

      const result = await modifyStopOrder(123, 150.0);

      expect(result.success).toBe(true);
      expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
      
      const [orderId, contract, order] = mockPlaceOrder.mock.calls[0];
      expect(orderId).toBe(123);
      expect(contract.symbol).toBe("AAPL");
      expect(order.auxPrice).toBe(150.0);
      expect(order.orderType).toBe("STP");
    });

    it("should preserve OCA group when modifying order", async () => {
      mockOpenOrders = [{
        orderId: 123,
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        action: "BUY",
        orderType: "STP",
        totalQuantity: 100,
        lmtPrice: null,
        auxPrice: 148.0,
        status: "Submitted",
        remaining: 100,
        tif: "GTC",
        parentId: 0,
        ocaGroup: "OCA_ORIGINAL",
        account: "U1234567",
      }];

      await modifyStopOrder(123, 150.0);

      const [, , order] = mockPlaceOrder.mock.calls[0];
      expect((order as any).ocaGroup).toBe("OCA_ORIGINAL");
    });

    it("should override OCA group when explicitly provided", async () => {
      mockOpenOrders = [{
        orderId: 123,
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        action: "BUY",
        orderType: "STP",
        totalQuantity: 100,
        lmtPrice: null,
        auxPrice: 148.0,
        status: "Submitted",
        remaining: 100,
        tif: "GTC",
        parentId: 0,
        ocaGroup: "OCA_ORIGINAL",
        account: "U1234567",
      }];

      await modifyStopOrder(123, 150.0, "OCA_NEW");

      const [, , order] = mockPlaceOrder.mock.calls[0];
      expect((order as any).ocaGroup).toBe("OCA_NEW");
    });

    it("should only modify orders with status PreSubmitted or Submitted", async () => {
      mockOpenOrders = [{
        orderId: 123,
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        action: "BUY",
        orderType: "STP",
        totalQuantity: 100,
        lmtPrice: null,
        auxPrice: 148.0,
        status: "Filled",
        remaining: 0,
        tif: "GTC",
        parentId: 0,
        ocaGroup: "",
        account: "U1234567",
      }];

      const result = await modifyStopOrder(123, 150.0);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot modify order with status Filled");
      expect(mockPlaceOrder).not.toHaveBeenCalled();
    });

    it("should handle PreSubmitted status", async () => {
      mockOpenOrders = [{
        orderId: 123,
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        action: "BUY",
        orderType: "STP",
        totalQuantity: 100,
        lmtPrice: null,
        auxPrice: 148.0,
        status: "PreSubmitted",
        remaining: 100,
        tif: "GTC",
        parentId: 0,
        ocaGroup: "",
        account: "U1234567",
      }];

      const result = await modifyStopOrder(123, 150.0);

      expect(result.success).toBe(true);
      expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
    });

    it("should return error when order not found", async () => {
      mockOpenOrders = [];

      const result = await modifyStopOrder(999, 150.0);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Order not found");
      expect(mockPlaceOrder).not.toHaveBeenCalled();
    });

    it("should handle IBKR API errors gracefully", async () => {
      mockOpenOrders = [{
        orderId: 123,
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        action: "BUY",
        orderType: "STP",
        totalQuantity: 100,
        lmtPrice: null,
        auxPrice: 148.0,
        status: "Submitted",
        remaining: 100,
        tif: "GTC",
        parentId: 0,
        ocaGroup: "",
        account: "U1234567",
      }];

      mockPlaceOrder.mockImplementation(() => {
        throw new Error("Connection lost");
      });

      const result = await modifyStopOrder(123, 150.0);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection lost");
    });
  });

  // ── Position State Management ───────────────────────────────────────────

  describe("updatePosition()", () => {
    it("should create new position with initial high water mark", () => {
      updatePosition("AAPL", 155.0, 100, 150.0, 500.0, 123, 148.0);

      const state = getExecutorState();
      const position = state.positions.get("AAPL");

      expect(position).toBeDefined();
      expect(position?.highWaterMark).toBe(155.0);
      expect(position?.breakevenTriggered).toBe(false);
    });

    it("should update high water mark for long position (price increases)", () => {
      updatePosition("AAPL", 155.0, 100, 150.0, 500.0, 123, 148.0);
      updatePosition("AAPL", 157.0, 100, 150.0, 700.0, 123, 150.0);

      const state = getExecutorState();
      const position = state.positions.get("AAPL");

      expect(position?.highWaterMark).toBe(157.0);
    });

    it("should not update high water mark for long position (price decreases)", () => {
      updatePosition("AAPL", 155.0, 100, 150.0, 500.0, 123, 148.0);
      updatePosition("AAPL", 153.0, 100, 150.0, 300.0, 123, 150.0);

      const state = getExecutorState();
      const position = state.positions.get("AAPL");

      expect(position?.highWaterMark).toBe(155.0);
    });

    it("should update high water mark for short position (price decreases)", () => {
      updatePosition("TSLA", 200.0, -100, 205.0, 500.0, 124, 208.0);
      updatePosition("TSLA", 198.0, -100, 205.0, 700.0, 124, 206.0);

      const state = getExecutorState();
      const position = state.positions.get("TSLA");

      expect(position?.highWaterMark).toBe(198.0);
    });

    it("should not update high water mark for short position (price increases)", () => {
      updatePosition("TSLA", 200.0, -100, 205.0, 500.0, 124, 208.0);
      updatePosition("TSLA", 202.0, -100, 205.0, 300.0, 124, 206.0);

      const state = getExecutorState();
      const position = state.positions.get("TSLA");

      expect(position?.highWaterMark).toBe(200.0);
    });

    it("should trigger breakeven flag when R-multiple threshold reached", () => {
      startExecutor({
        type: "breakeven_trail",
        be_trigger_r: 1.0,
        post_be_trail_pct: 1.0,
      });

      // Initial position, not at breakeven yet
      updatePosition("AAPL", 151.0, 100, 150.0, 100.0, 123, 148.0);
      let state = getExecutorState();
      expect(state.positions.get("AAPL")?.breakevenTriggered).toBe(false);

      // Now at 1R (300 = 150 * 100 * 0.02)
      updatePosition("AAPL", 153.0, 100, 150.0, 300.0, 123, 148.0);
      state = getExecutorState();
      expect(state.positions.get("AAPL")?.breakevenTriggered).toBe(true);
    });
  });

  describe("removePosition()", () => {
    it("should remove position from tracking", () => {
      updatePosition("AAPL", 155.0, 100, 150.0, 500.0, 123, 148.0);
      
      let state = getExecutorState();
      expect(state.positions.has("AAPL")).toBe(true);

      removePosition("AAPL");

      state = getExecutorState();
      expect(state.positions.has("AAPL")).toBe(false);
    });
  });

  // ── Bulk Processing ──────────────────────────────────────────────────────

  describe("processTrailingStops()", () => {
    it("should process multiple positions and modify trailing stops", async () => {
      startExecutor({ type: "fixed_pct", trail_pct: 2.0 });

      // Setup positions
      updatePosition("AAPL", 155.0, 100, 150.0, 500.0, 123, 148.0);
      updatePosition("TSLA", 205.0, 50, 200.0, 250.0, 124, 198.0);

      // Mock orders as modifiable
      mockOpenOrders = [
        {
          orderId: 123,
          symbol: "AAPL",
          secType: "STK",
          exchange: "SMART",
          currency: "USD",
          action: "BUY",
          orderType: "STP",
          totalQuantity: 100,
          lmtPrice: null,
          auxPrice: 148.0,
          status: "Submitted",
          remaining: 100,
          tif: "GTC",
          parentId: 0,
          ocaGroup: "",
          account: "U1234567",
        },
        {
          orderId: 124,
          symbol: "TSLA",
          secType: "STK",
          exchange: "SMART",
          currency: "USD",
          action: "BUY",
          orderType: "STP",
          totalQuantity: 50,
          lmtPrice: null,
          auxPrice: 198.0,
          status: "Submitted",
          remaining: 50,
          tif: "GTC",
          parentId: 0,
          ocaGroup: "",
          account: "U1234567",
        },
      ];

      const result = await processTrailingStops();

      expect(result.processed).toBe(2);
      expect(result.modified).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(mockPlaceOrder).toHaveBeenCalledTimes(2);
    });

    it("should only tighten stops, never loosen them", async () => {
      startExecutor({ type: "fixed_pct", trail_pct: 2.0 });

      // Position where calculated stop (151.9) is lower than current stop (152.0)
      updatePosition("AAPL", 155.0, 100, 150.0, 500.0, 123, 152.0);

      mockOpenOrders = [{
        orderId: 123,
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        action: "BUY",
        orderType: "STP",
        totalQuantity: 100,
        lmtPrice: null,
        auxPrice: 152.0,
        status: "Submitted",
        remaining: 100,
        tif: "GTC",
        parentId: 0,
        ocaGroup: "",
        account: "U1234567",
      }];

      const result = await processTrailingStops();

      expect(result.processed).toBe(1);
      expect(result.modified).toBe(0); // Should not loosen stop
      expect(mockPlaceOrder).not.toHaveBeenCalled();
    });

    it("should skip positions without stop orders", async () => {
      startExecutor({ type: "fixed_pct", trail_pct: 2.0 });

      updatePosition("AAPL", 155.0, 100, 150.0, 500.0); // No stop order ID

      const result = await processTrailingStops();

      expect(result.processed).toBe(1);
      expect(result.modified).toBe(0);
      expect(mockPlaceOrder).not.toHaveBeenCalled();
    });

    it("should collect errors for failed modifications", async () => {
      startExecutor({ type: "fixed_pct", trail_pct: 2.0 });

      updatePosition("AAPL", 155.0, 100, 150.0, 500.0, 123, 148.0);

      mockOpenOrders = [{
        orderId: 123,
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        action: "BUY",
        orderType: "STP",
        totalQuantity: 100,
        lmtPrice: null,
        auxPrice: 148.0,
        status: "Cancelled",
        remaining: 100,
        tif: "GTC",
        parentId: 0,
        ocaGroup: "",
        account: "U1234567",
      }];

      const result = await processTrailingStops();

      expect(result.processed).toBe(1);
      expect(result.modified).toBe(0);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0]).toContain("AAPL");
    });

    it("should not process when executor is stopped", async () => {
      stopExecutor();

      updatePosition("AAPL", 155.0, 100, 150.0, 500.0, 123, 148.0);

      const result = await processTrailingStops();

      expect(result.processed).toBe(0);
      expect(result.modified).toBe(0);
      expect(mockPlaceOrder).not.toHaveBeenCalled();
    });
  });

  // ── Executor Control ─────────────────────────────────────────────────────

  describe("startExecutor() and stopExecutor()", () => {
    it("should start executor with default config", () => {
      startExecutor();

      const state = getExecutorState();
      expect(state.running).toBe(true);
      expect(state.config.type).toBe("fixed_pct");
      expect(state.config.trail_pct).toBe(2.0);
    });

    it("should start executor with custom config", () => {
      const config: TrailingStopConfig = {
        type: "atr_multiple",
        atr_mult: 1.5,
      };

      startExecutor(config);

      const state = getExecutorState();
      expect(state.running).toBe(true);
      expect(state.config.type).toBe("atr_multiple");
      expect(state.config.atr_mult).toBe(1.5);
    });

    it("should stop executor", () => {
      startExecutor();
      stopExecutor();

      const state = getExecutorState();
      expect(state.running).toBe(false);
    });
  });

  // ── Edge Cases ───────────────────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("should handle position closed scenario", async () => {
      startExecutor({ type: "fixed_pct", trail_pct: 2.0 });

      updatePosition("AAPL", 155.0, 100, 150.0, 500.0, 123, 148.0);
      
      // Position gets closed
      removePosition("AAPL");

      const result = await processTrailingStops();

      expect(result.processed).toBe(0);
      expect(mockPlaceOrder).not.toHaveBeenCalled();
    });

    it("should handle order rejected scenario", async () => {
      startExecutor({ type: "fixed_pct", trail_pct: 2.0 });

      updatePosition("AAPL", 155.0, 100, 150.0, 500.0, 123, 148.0);

      mockOpenOrders = [{
        orderId: 123,
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        action: "BUY",
        orderType: "STP",
        totalQuantity: 100,
        lmtPrice: null,
        auxPrice: 148.0,
        status: "Cancelled",
        remaining: 100,
        tif: "GTC",
        parentId: 0,
        ocaGroup: "",
        account: "U1234567",
      }];

      const result = await processTrailingStops();

      expect(result.processed).toBe(1);
      expect(result.modified).toBe(0);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle connection lost scenario", async () => {
      startExecutor({ type: "fixed_pct", trail_pct: 2.0 });

      updatePosition("AAPL", 155.0, 100, 150.0, 500.0, 123, 148.0);

      mockOpenOrders = [{
        orderId: 123,
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        action: "BUY",
        orderType: "STP",
        totalQuantity: 100,
        lmtPrice: null,
        auxPrice: 148.0,
        status: "Submitted",
        remaining: 100,
        tif: "GTC",
        parentId: 0,
        ocaGroup: "",
        account: "U1234567",
      }];

      mockPlaceOrder.mockImplementation(() => {
        throw new Error("Connection timeout");
      });

      const result = await processTrailingStops();

      expect(result.processed).toBe(1);
      expect(result.modified).toBe(0);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0]).toContain("Connection timeout");
    });

    it("should handle multiple positions with mixed results", async () => {
      startExecutor({ type: "fixed_pct", trail_pct: 2.0 });

      updatePosition("AAPL", 155.0, 100, 150.0, 500.0, 123, 148.0);
      updatePosition("TSLA", 205.0, 50, 200.0, 250.0, 124, 198.0);
      updatePosition("MSFT", 350.0, 30, 340.0, 300.0, 125, 342.0);

      mockOpenOrders = [
        {
          orderId: 123,
          symbol: "AAPL",
          secType: "STK",
          exchange: "SMART",
          currency: "USD",
          action: "BUY",
          orderType: "STP",
          totalQuantity: 100,
          lmtPrice: null,
          auxPrice: 148.0,
          status: "Submitted",
          remaining: 100,
          tif: "GTC",
          parentId: 0,
          ocaGroup: "",
          account: "U1234567",
        },
        {
          orderId: 124,
          symbol: "TSLA",
          secType: "STK",
          exchange: "SMART",
          currency: "USD",
          action: "BUY",
          orderType: "STP",
          totalQuantity: 50,
          lmtPrice: null,
          auxPrice: 198.0,
          status: "Cancelled",
          remaining: 50,
          tif: "GTC",
          parentId: 0,
          ocaGroup: "",
          account: "U1234567",
        },
        {
          orderId: 125,
          symbol: "MSFT",
          secType: "STK",
          exchange: "SMART",
          currency: "USD",
          action: "BUY",
          orderType: "STP",
          totalQuantity: 30,
          lmtPrice: null,
          auxPrice: 342.0,
          status: "Submitted",
          remaining: 30,
          tif: "GTC",
          parentId: 0,
          ocaGroup: "",
          account: "U1234567",
        },
      ];

      const result = await processTrailingStops();

      expect(result.processed).toBe(3);
      expect(result.modified).toBe(2); // AAPL and MSFT succeed
      expect(result.errors.length).toBeGreaterThanOrEqual(1); // TSLA fails
      expect(mockPlaceOrder).toHaveBeenCalledTimes(2);
    });
  });
});
