import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { EventName } from "@stoqey/ib";

class MockIB extends EventEmitter {
  reqContractDetails = vi.fn();
}

const mockIBInstance = new MockIB();
let reqIdCounter = 1;

vi.mock("../connection.js", () => ({
  getIB: vi.fn(() => mockIBInstance),
  getNextReqId: vi.fn(() => reqIdCounter++),
}));

import { getContractDetails } from "../contracts.js";

describe("contracts.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIBInstance.removeAllListeners();
    reqIdCounter = 1;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getContractDetails", () => {
    it("fetches contract details successfully", async () => {
      const promise = getContractDetails({ symbol: "AAPL" });

      expect(mockIBInstance.reqContractDetails).toHaveBeenCalledWith(1, {
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
      });

      mockIBInstance.emit(EventName.contractDetails, 1, {
        contract: { conId: 1234, symbol: "AAPL", secType: "STK", exchange: "SMART", currency: "USD", localSymbol: "AAPL", tradingClass: "NMS", multiplier: null },
        marketName: "NMS",
        minTick: 0.01,
        orderTypes: "LMT,MKT",
        validExchanges: "SMART,AMEX",
        longName: "Apple Inc.",
        industry: "Technology",
        category: "Computers",
        subcategory: "Computers",
        contractMonth: "",
        timeZoneId: "EST",
        tradingHours: "0930-1600",
        liquidHours: "0930-1600",
      });
      mockIBInstance.emit(EventName.contractDetailsEnd, 1);

      const res = await promise;
      expect(res).toHaveLength(1);
      expect(res[0].conId).toBe(1234);
      expect(res[0].symbol).toBe("AAPL");
      expect(res[0].longName).toBe("Apple Inc.");
    });

    it("handles timeout", async () => {
      vi.useFakeTimers();
      const promise = getContractDetails({ symbol: "AAPL" });

      vi.advanceTimersByTime(10000);

      const res = await promise;
      expect(res).toEqual([]); // Timeout resolves what has been accumulated
    });

    it("handles API error", async () => {
      const promise = getContractDetails({ symbol: "AAPL" });
      mockIBInstance.emit(EventName.error, new Error("API error"), 502, 1);

      await expect(promise).rejects.toThrow("Contract details error (502): API error");
    });

    it("ignores non-fatal errors", async () => {
      const promise = getContractDetails({ symbol: "AAPL" });
      mockIBInstance.emit(EventName.error, new Error("Warning"), 2104, 1);
      mockIBInstance.emit(EventName.contractDetailsEnd, 1);

      const res = await promise;
      expect(res).toEqual([]);
    });
  });
});
