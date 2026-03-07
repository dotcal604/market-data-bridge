import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { EventName } from "@stoqey/ib";

class MockIB extends EventEmitter {
  reqPnLSingle = vi.fn();
  cancelPnLSingle = vi.fn();
  reqMatchingSymbols = vi.fn();
  reqMarketDataType = vi.fn();
  reqAutoOpenOrders = vi.fn();
  reqHeadTimestamp = vi.fn();
  reqHistogramData = vi.fn();
  calculateImpliedVolatility = vi.fn();
  cancelCalculateImpliedVolatility = vi.fn();
  calculateOptionPrice = vi.fn();
  cancelCalculateOptionPrice = vi.fn();
  reqCurrentTime = vi.fn();
  reqMarketRule = vi.fn();
  reqSmartComponents = vi.fn();
  reqMktDepthExchanges = vi.fn();
  reqFundamentalData = vi.fn();
  cancelFundamentalData = vi.fn();
}

const mockIBInstance = new MockIB();
let reqIdCounter = 1;

vi.mock("../connection.js", () => ({
  getIB: vi.fn(() => mockIBInstance),
  getNextReqId: vi.fn(() => reqIdCounter++),
  isConnected: vi.fn(() => true),
}));

vi.mock("../account.js", () => ({
  getAccountSummary: vi.fn().mockResolvedValue({ account: "U123" }),
}));

vi.mock("../contracts.js", () => ({
  getContractDetails: vi.fn().mockResolvedValue([{ conId: 456 }]),
}));

import {
  reqPnLSingleBySymbol,
  reqMatchingSymbols,
  reqMarketDataType,
  reqAutoOpenOrders,
  reqHeadTimestampBySymbol,
  reqHistogramDataBySymbol,
  calculateImpliedVolatility,
  calculateOptionPrice,
  reqCurrentTime,
  reqMarketRule,
  reqSmartComponents,
  reqMktDepthExchanges,
  reqFundamentalDataBySymbol,
} from "../data.js";

describe("data.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIBInstance.removeAllListeners();
    reqIdCounter = 1;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("reqPnLSingleBySymbol", () => {
    it("fetches PnL single successfully", async () => {
      const promise = reqPnLSingleBySymbol("AAPL");
      
      // Allow async resolution of account summary and contract details
      await vi.waitFor(() => {
        expect(mockIBInstance.reqPnLSingle).toHaveBeenCalledWith(1, "U123", null, 456);
      });

      mockIBInstance.emit(EventName.pnlSingle, 1, 100, 50.5, 10.1, 40.4, 15000);

      const res = await promise;
      expect(res).toMatchObject({
        symbol: "AAPL",
        conId: 456,
        position: 100,
        dailyPnL: 50.5,
        unrealizedPnL: 10.1,
        realizedPnL: 40.4,
        value: 15000,
      });
      expect(mockIBInstance.cancelPnLSingle).toHaveBeenCalledWith(1);
    });

    it("handles timeout", async () => {
      vi.useFakeTimers();
      const promise = reqPnLSingleBySymbol("AAPL");
      
      const expectPromise = expect(promise).rejects.toThrow("reqPnLSingle timed out");
      
      await vi.advanceTimersByTimeAsync(1); // resolve internal mocks
      await vi.advanceTimersByTimeAsync(10000);

      await expectPromise;
      expect(mockIBInstance.cancelPnLSingle).toHaveBeenCalledWith(1);
    });
  });

  describe("reqMatchingSymbols", () => {
    it("fetches successfully", async () => {
      const promise = reqMatchingSymbols("AAP");
      expect(mockIBInstance.reqMatchingSymbols).toHaveBeenCalledWith(1, "AAP");

      mockIBInstance.emit(EventName.symbolSamples, 1, [{ contract: { symbol: "AAPL" } }]);
      
      const res = await promise;
      expect(res).toHaveLength(1);
    });
  });

  describe("reqMarketDataType", () => {
    it("sets successfully", async () => {
      const promise = reqMarketDataType(3);
      expect(mockIBInstance.reqMarketDataType).toHaveBeenCalledWith(3);

      // reqId comes back as 1st param for marketDataType in Node-IB sometimes, verify signature
      mockIBInstance.emit(EventName.marketDataType, 1, 3);
      
      const res = await promise;
      expect(res).toEqual({ marketDataType: 3, reqId: 1 });
    });
  });

  describe("reqAutoOpenOrders", () => {
    it("calls successfully", async () => {
      const res = await reqAutoOpenOrders(true);
      expect(mockIBInstance.reqAutoOpenOrders).toHaveBeenCalledWith(true);
      expect(res).toEqual({ enabled: true });
    });
  });

  describe("reqHeadTimestampBySymbol", () => {
    it("fetches successfully", async () => {
      const promise = reqHeadTimestampBySymbol({ symbol: "AAPL", whatToShow: "TRADES", useRTH: true, formatDate: 1 });
      expect(mockIBInstance.reqHeadTimestamp).toHaveBeenCalled();

      mockIBInstance.emit(EventName.headTimestamp, 1, "20200101-09:30:00");
      
      const res = await promise;
      expect(res).toEqual({ symbol: "AAPL", headTimestamp: "20200101-09:30:00" });
    });
  });

  describe("reqHistogramDataBySymbol", () => {
    it("fetches successfully", async () => {
      const promise = reqHistogramDataBySymbol({ symbol: "AAPL", useRTH: true, period: 1, periodUnit: "W" });
      expect(mockIBInstance.reqHistogramData).toHaveBeenCalled();

      mockIBInstance.emit(EventName.histogramData, 1, [{ price: 150, size: 1000 }]);
      
      const res = await promise;
      expect(res).toEqual({ symbol: "AAPL", items: [{ price: 150, size: 1000 }] });
    });
  });

  describe("calculateImpliedVolatility", () => {
    it("calculates successfully", async () => {
      const promise = calculateImpliedVolatility({ symbol: "AAPL", expiry: "20240101", strike: 150, right: "C", optionPrice: 5.5, underlyingPrice: 150 });
      expect(mockIBInstance.calculateImpliedVolatility).toHaveBeenCalled();

      // id, tickType, impliedVolatility, delta, optPrice, pvDividend, gamma, vega, theta, undPrice
      mockIBInstance.emit(EventName.tickOptionComputation, 1, 53, 0.25, 0.5, 5.5, 0, 0, 0, 0, 150);
      
      const res = await promise;
      expect(res).toMatchObject({ impliedVolatility: 0.25, delta: 0.5, optPrice: 5.5, undPrice: 150 });
    });
  });

  describe("calculateOptionPrice", () => {
    it("calculates successfully", async () => {
      const promise = calculateOptionPrice({ symbol: "AAPL", expiry: "20240101", strike: 150, right: "C", volatility: 0.25, underlyingPrice: 150 });
      expect(mockIBInstance.calculateOptionPrice).toHaveBeenCalled();

      mockIBInstance.emit(EventName.tickOptionComputation, 1, 53, 0.25, 0.5, 5.5, 0, 0, 0, 0, 150);
      
      const res = await promise;
      expect(res).toMatchObject({ optPrice: 5.5 });
    });
  });

  describe("reqCurrentTime", () => {
    it("fetches successfully", async () => {
      const promise = reqCurrentTime();
      expect(mockIBInstance.reqCurrentTime).toHaveBeenCalled();

      mockIBInstance.emit(EventName.currentTime, 1600000000);
      
      const res = await promise;
      expect(res.epochSeconds).toBe(1600000000);
    });
  });

  describe("reqMarketRule", () => {
    it("fetches successfully", async () => {
      const promise = reqMarketRule(26);
      expect(mockIBInstance.reqMarketRule).toHaveBeenCalledWith(26);

      mockIBInstance.emit(EventName.marketRule, 26, [{ lowEdge: 0, increment: 0.01 }]);
      
      const res = await promise;
      expect(res.ruleId).toBe(26);
    });
  });

  describe("reqSmartComponents", () => {
    it("fetches successfully", async () => {
      const promise = reqSmartComponents("SMART");
      expect(mockIBInstance.reqSmartComponents).toHaveBeenCalledWith(1, "SMART");

      const theMap = new Map();
      theMap.set(1, ["ISLAND", "a"]);
      mockIBInstance.emit(EventName.smartComponents, 1, theMap);
      
      const res = await promise;
      expect(res.components[0].exchange).toBe("ISLAND");
    });
  });

  describe("reqMktDepthExchanges", () => {
    it("fetches successfully", async () => {
      const promise = reqMktDepthExchanges();
      expect(mockIBInstance.reqMktDepthExchanges).toHaveBeenCalled();

      mockIBInstance.emit(EventName.mktDepthExchanges, [{ exchange: "ARCA" }]);
      
      const res = await promise;
      expect(res.exchanges).toHaveLength(1);
    });
  });

  describe("reqFundamentalDataBySymbol", () => {
    it("fetches successfully", async () => {
      const promise = reqFundamentalDataBySymbol({ symbol: "AAPL", reportType: "ReportsFinSummary" });
      expect(mockIBInstance.reqFundamentalData).toHaveBeenCalled();

      mockIBInstance.emit(EventName.fundamentalData, 1, "<xml></xml>");
      
      const res = await promise;
      expect(res.data).toBe("<xml></xml>");
    });
  });
});
