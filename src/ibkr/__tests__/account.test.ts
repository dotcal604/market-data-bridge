import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { EventName } from "@stoqey/ib";

class MockIB extends EventEmitter {
  reqAccountSummary = vi.fn();
  cancelAccountSummary = vi.fn();
  reqPositions = vi.fn();
  cancelPositions = vi.fn();
  reqPnL = vi.fn();
  cancelPnL = vi.fn();
}

const mockIBInstance = new MockIB();
let reqIdCounter = 1;

vi.mock("../connection.js", () => {
  return {
    getIB: vi.fn(() => mockIBInstance),
    getNextReqId: vi.fn(() => reqIdCounter++),
  };
});

// Import the module under test AFTER mocks have been defined
import { getAccountSummary, getPositions, getPnL } from "../account.js";

describe("account.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIBInstance.removeAllListeners();
    reqIdCounter = 1;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getAccountSummary", () => {
    it("fetches account summary successfully", async () => {
      const promise = getAccountSummary();

      expect(mockIBInstance.reqAccountSummary).toHaveBeenCalledWith(1, "All", expect.any(String));

      // Emit data
      mockIBInstance.emit(EventName.accountSummary, 1, "U123", "NetLiquidation", "100000.50", "USD");
      mockIBInstance.emit(EventName.accountSummary, 1, "U123", "BuyingPower", "400000.00", "USD");
      mockIBInstance.emit(EventName.accountSummaryEnd, 1);

      const res = await promise;
      expect(res.account).toBe("U123");
      expect(res.netLiquidation).toBe(100000.5);
      expect(res.buyingPower).toBe(400000);
      expect(res.currency).toBe("USD");
      expect(res.timestamp).toBeDefined();
    });

    it("handles timeout", async () => {
      vi.useFakeTimers();
      const promise = getAccountSummary();

      vi.advanceTimersByTime(10000);

      await expect(promise).rejects.toThrow("Account summary request timed out");
      expect(mockIBInstance.cancelAccountSummary).toHaveBeenCalledWith(1);
    });

    it("handles API error", async () => {
      const promise = getAccountSummary();
      mockIBInstance.emit(EventName.error, new Error("API error"), 502, 1);

      await expect(promise).rejects.toThrow("Account summary error (502): API error");
      expect(mockIBInstance.cancelAccountSummary).toHaveBeenCalledWith(1);
    });

    it("ignores non-fatal errors", async () => {
      const promise = getAccountSummary();
      // 2104 is a typical non-fatal error (Market data farm connection is OK)
      mockIBInstance.emit(EventName.error, new Error("Warning"), 2104, 1);

      // Should not reject. We can emit end to resolve it.
      mockIBInstance.emit(EventName.accountSummaryEnd, 1);

      const res = await promise;
      expect(res).toBeDefined();
      expect(mockIBInstance.cancelAccountSummary).toHaveBeenCalledWith(1);
    });
  });

  describe("getPositions", () => {
    it("fetches positions successfully", async () => {
      const promise = getPositions();

      expect(mockIBInstance.reqPositions).toHaveBeenCalled();

      mockIBInstance.emit(EventName.position, "U123", { symbol: "AAPL", secType: "STK", exchange: "SMART", currency: "USD" }, 100, 150.5);
      mockIBInstance.emit(EventName.positionEnd);

      const res = await promise;
      expect(res).toHaveLength(1);
      expect(res[0]).toEqual({
        account: "U123",
        symbol: "AAPL",
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
        position: 100,
        avgCost: 150.5,
      });
    });

    it("handles timeout by returning current positions", async () => {
      vi.useFakeTimers();
      const promise = getPositions();

      // Emit one position before timeout
      mockIBInstance.emit(EventName.position, "U123", { symbol: "MSFT", secType: "STK" }, 50, 200.0);

      vi.advanceTimersByTime(10000);

      const res = await promise;
      expect(res).toHaveLength(1);
      expect(res[0].symbol).toBe("MSFT");
      expect(mockIBInstance.cancelPositions).toHaveBeenCalled();
    });

    it("handles API error", async () => {
      const promise = getPositions();

      // Error from generic subscription usually has id <= 0
      mockIBInstance.emit(EventName.error, new Error("Pos error"), 502, -1);

      await expect(promise).rejects.toThrow("Positions error (502): Pos error");
      expect(mockIBInstance.cancelPositions).toHaveBeenCalled();
    });

    it("ignores error 300 (benign TWS noise)", async () => {
      const promise = getPositions();

      mockIBInstance.emit(EventName.error, new Error("Can't find EId with tickerId"), 300, -1);

      // Should not reject. We emit end to resolve
      mockIBInstance.emit(EventName.positionEnd);

      const res = await promise;
      expect(res).toEqual([]);
    });

    it("ignores errors targeted at specific requests (id > 0)", async () => {
      const promise = getPositions();

      mockIBInstance.emit(EventName.error, new Error("Other request error"), 504, 42); // id > 0

      mockIBInstance.emit(EventName.positionEnd);

      const res = await promise;
      expect(res).toEqual([]);
    });
  });

  describe("getPnL", () => {
    beforeEach(() => {
      // Mock getAccountSummary by intercepting reqAccountSummary
      mockIBInstance.reqAccountSummary.mockImplementation((reqId) => {
        process.nextTick(() => {
          mockIBInstance.emit(EventName.accountSummary, reqId, "U123", "NetLiquidation", "1000", "USD");
          mockIBInstance.emit(EventName.accountSummaryEnd, reqId);
        });
      });
    });

    it("fetches PnL successfully", async () => {
      const promise = getPnL();

      // Wait for PnL request to be issued (which happens after account summary)
      await vi.waitFor(() => {
        expect(mockIBInstance.reqPnL).toHaveBeenCalled();
      });

      const pnlReqId = mockIBInstance.reqPnL.mock.calls[0][0];
      const account = mockIBInstance.reqPnL.mock.calls[0][1];
      expect(account).toBe("U123");

      mockIBInstance.emit(EventName.pnl, pnlReqId, 50.5, 10.1, 40.4);

      const res = await promise;
      expect(res.account).toBe("U123");
      expect(res.dailyPnL).toBe(50.5);
      expect(res.unrealizedPnL).toBe(10.1);
      expect(res.realizedPnL).toBe(40.4);
      expect(res.timestamp).toBeDefined();
    });

    it("handles timeout by resolving current data", async () => {
      vi.useFakeTimers();
      const promise = getPnL();

      // Allow getAccountSummary microtasks to run
      await vi.advanceTimersByTimeAsync(1);

      // Now we wait for the 10000ms timeout of getPnL
      await vi.advanceTimersByTimeAsync(10000);

      const res = await promise;
      expect(res.account).toBe("U123");
      expect(res.dailyPnL).toBeNull();
      expect(mockIBInstance.cancelPnL).toHaveBeenCalled();
    });

    it("handles API error", async () => {
      const promise = getPnL();

      await vi.waitFor(() => {
        expect(mockIBInstance.reqPnL).toHaveBeenCalled();
      });

      const pnlReqId = mockIBInstance.reqPnL.mock.calls[0][0];
      mockIBInstance.emit(EventName.error, new Error("PnL error"), 502, pnlReqId);

      await expect(promise).rejects.toThrow("PnL error (502): PnL error");
      expect(mockIBInstance.cancelPnL).toHaveBeenCalledWith(pnlReqId);
    });

    it("throws if account cannot be determined", async () => {
      mockIBInstance.reqAccountSummary.mockReset();
      
      // Resolve with no account
      mockIBInstance.reqAccountSummary.mockImplementation((reqId) => {
        process.nextTick(() => {
          mockIBInstance.emit(EventName.accountSummaryEnd, reqId);
        });
      });

      await expect(getPnL()).rejects.toThrow("Could not determine account ID for PnL request");
    });
  });
});
