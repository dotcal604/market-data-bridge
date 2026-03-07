import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { EventName } from "@stoqey/ib";

class MockIB extends EventEmitter {
  reqMktData = vi.fn();
  cancelMktData = vi.fn();
  reqHistoricalTicks = vi.fn();
  reqMktDepth = vi.fn();
  cancelMktDepth = vi.fn();
}

const mockIBInstance = new MockIB();
let reqIdCounter = 1;

vi.mock("../connection.js", () => ({
  getIB: vi.fn(() => mockIBInstance),
  getNextReqId: vi.fn(() => reqIdCounter++),
  isConnected: vi.fn(() => true),
}));

import { getIBKRQuote, getHistoricalTicks, getMarketDepth } from "../marketdata.js";

describe("marketdata.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIBInstance.removeAllListeners();
    reqIdCounter = 1;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getIBKRQuote", () => {
    it("fetches snapshot successfully", async () => {
      const promise = getIBKRQuote({ symbol: "AAPL" });
      expect(mockIBInstance.reqMktData).toHaveBeenCalledWith(1, expect.objectContaining({ symbol: "AAPL" }), "", true, false);

      mockIBInstance.emit(EventName.tickPrice, 1, 1, 150.0); // TICK_BID
      mockIBInstance.emit(EventName.tickPrice, 1, 2, 150.1); // TICK_ASK
      mockIBInstance.emit(EventName.tickPrice, 1, 4, 150.05); // TICK_LAST
      mockIBInstance.emit(EventName.tickSize, 1, 8, 10000); // TICK_VOLUME
      mockIBInstance.emit(EventName.tickSnapshotEnd, 1);

      const res = await promise;
      expect(res.bid).toBe(150.0);
      expect(res.ask).toBe(150.1);
      expect(res.last).toBe(150.05);
      expect(res.volume).toBe(10000);
      expect(res.staleness_warning).toBeNull();
    });

    it("handles timeout and partial data", async () => {
      vi.useFakeTimers();
      const promise = getIBKRQuote({ symbol: "AAPL" });

      mockIBInstance.emit(EventName.tickPrice, 1, 4, 150.05); // TICK_LAST only
      
      vi.advanceTimersByTime(5000);

      const res = await promise;
      expect(res.last).toBe(150.05);
      expect(res.bid).toBeNull();
      // Has partial data so staleness warning should not trigger
      expect(res.staleness_warning).toBeNull();
      expect(mockIBInstance.cancelMktData).toHaveBeenCalledWith(1);
    });
    
    it("handles timeout with no data", async () => {
      vi.useFakeTimers();
      const promise = getIBKRQuote({ symbol: "AAPL" });
      
      vi.advanceTimersByTime(5000);

      const res = await promise;
      expect(res.last).toBeNull();
      expect(res.staleness_warning).toBe("IBKR snapshot timed out with no price data.");
    });

    it("handles API error", async () => {
      const promise = getIBKRQuote({ symbol: "AAPL" });
      mockIBInstance.emit(EventName.error, new Error("API error"), 502, 1);

      await expect(promise).rejects.toThrow("Market data error (502): API error");
      expect(mockIBInstance.cancelMktData).toHaveBeenCalledWith(1);
    });
  });

  describe("getHistoricalTicks", () => {
    it("fetches MIDPOINT successfully", async () => {
      const promise = getHistoricalTicks("AAPL", "start", "end", "MIDPOINT", 100);
      expect(mockIBInstance.reqHistoricalTicks).toHaveBeenCalled();

      mockIBInstance.emit(EventName.historicalTicks, 1, [{ time: 1000, price: 150.0, size: 10 }], true);

      const res = await promise;
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({ type: "MIDPOINT", price: 150.0 });
    });

    it("fetches BID_ASK successfully", async () => {
      const promise = getHistoricalTicks("AAPL", "start", "end", "BID_ASK", 100);
      
      mockIBInstance.emit(EventName.historicalTicksBidAsk, 1, [{ time: 1000, priceBid: 149.9, priceAsk: 150.1 }], true);

      const res = await promise;
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({ type: "BID_ASK", bidPrice: 149.9 });
    });

    it("fetches TRADES successfully", async () => {
      const promise = getHistoricalTicks("AAPL", "start", "end", "TRADES", 100);
      
      mockIBInstance.emit(EventName.historicalTicksLast, 1, [{ time: 1000, price: 150.0, size: 100 }], true);

      const res = await promise;
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({ type: "TRADES", price: 150.0 });
    });

    it("handles timeout", async () => {
      vi.useFakeTimers();
      const promise = getHistoricalTicks("AAPL", "start", "end", "TRADES", 100);
      
      vi.advanceTimersByTime(30000);

      await expect(promise).rejects.toThrow("Historical ticks request timed out");
    });
  });

  describe("getMarketDepth", () => {
    it("fetches depth successfully", async () => {
      vi.useFakeTimers();
      const promise = getMarketDepth("AAPL", 5, 5000);
      expect(mockIBInstance.reqMktDepth).toHaveBeenCalled();

      // L1 depth
      mockIBInstance.emit(EventName.updateMktDepth, 1, 0, 0, 1, 150.0, 100); // Insert Bid
      mockIBInstance.emit(EventName.updateMktDepth, 1, 0, 0, 0, 150.1, 100); // Insert Ask
      
      // L2 depth (from any cast in the module)
      mockIBInstance.emit("updateMktDepthL2", 1, 1, "MM1", 0, 1, 149.9, 50, false); // Insert Bid L2

      vi.advanceTimersByTime(5000);

      const res = await promise;
      expect(res.bids).toHaveLength(2);
      expect(res.asks).toHaveLength(1);
      expect(res.bids[0].price).toBe(150.0); // sorted desc
      expect(res.bids[1].price).toBe(149.9);
      expect(res.asks[0].price).toBe(150.1);
      expect(mockIBInstance.cancelMktDepth).toHaveBeenCalledWith(1, false);
    });

    it("handles API error", async () => {
      const promise = getMarketDepth("AAPL");
      mockIBInstance.emit(EventName.error, new Error("API error"), 502, 1);

      await expect(promise).rejects.toThrow("Market depth error (502): API error");
      expect(mockIBInstance.cancelMktDepth).toHaveBeenCalledWith(1, false);
    });
  });
});
