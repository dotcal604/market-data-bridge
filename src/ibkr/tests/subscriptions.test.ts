import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CONCURRENT,
  activeSubscriptions,
  clearScannerParametersCache,
  getActiveSubscriptions,
  getScannerParameters,
  subscribe,
  unsubscribe,
  unsubscribeAll,
} from "../subscriptions.js";

vi.mock("@stoqey/ib", () => ({
  EventName: {
    scannerParameters: "scannerParameters",
    error: "error",
  },
}));

const reqRealTimeBarsMock = vi.fn();
const cancelRealTimeBarsMock = vi.fn();
const reqAccountUpdatesMock = vi.fn();
const reqScannerParametersMock = vi.fn();
const onMock = vi.fn();
const offMock = vi.fn();

const handlers = new Map<string, (...args: unknown[]) => void>();

vi.mock("../connection.js", () => ({
  isConnected: vi.fn(() => true),
  getNextReqId: vi.fn(),
  getIB: vi.fn(() => ({
    reqRealTimeBars: reqRealTimeBarsMock,
    cancelRealTimeBars: cancelRealTimeBarsMock,
    reqAccountUpdates: reqAccountUpdatesMock,
    reqScannerParameters: reqScannerParametersMock,
    cancelTickByTickData: vi.fn(),
    cancelMktDepth: vi.fn(),
    cancelScannerSubscription: vi.fn(),
    on: onMock,
    off: offMock,
  })),
}));

import { getNextReqId, isConnected } from "../connection.js";

function setReqId(value: number): void {
  vi.mocked(getNextReqId).mockReturnValue(value);
}

describe("ibkr subscriptions", () => {
  beforeEach(() => {
    activeSubscriptions.clear();
    clearScannerParametersCache();
    handlers.clear();
    vi.clearAllMocks();
    vi.mocked(isConnected).mockReturnValue(true);

    onMock.mockImplementation((eventName: string, cb: (...args: unknown[]) => void) => {
      handlers.set(eventName, cb);
      return undefined;
    });
    offMock.mockImplementation((eventName: string) => {
      handlers.delete(eventName);
      return undefined;
    });
  });

  it("subscribe adds active subscription for realTimeBars", () => {
    setReqId(101);

    const reqId = subscribe("realTimeBars", {
      symbol: "AAPL",
      secType: "STK",
      exchange: "SMART",
      whatToShow: "TRADES",
    });

    expect(reqId).toBe(101);
    expect(reqRealTimeBarsMock).toHaveBeenCalledOnce();
    expect(activeSubscriptions.has(101)).toBe(true);
    expect(getActiveSubscriptions()).toHaveLength(1);
  });

  it("unsubscribe removes subscription and calls cancel", () => {
    setReqId(202);
    const reqId = subscribe("realTimeBars", { symbol: "MSFT" });

    unsubscribe(reqId);

    expect(cancelRealTimeBarsMock).toHaveBeenCalledWith(reqId);
    expect(activeSubscriptions.has(reqId)).toBe(false);
  });

  it("enforces maximum concurrent subscriptions", () => {
    for (let i = 1; i <= MAX_CONCURRENT; i += 1) {
      activeSubscriptions.set(i, {
        reqId: i,
        type: "realTimeBars",
        symbol: `SYM${i}`,
        startedAt: new Date(),
      });
    }

    setReqId(999);

    expect(() => subscribe("realTimeBars", { symbol: "TSLA" })).toThrow(
      `Maximum concurrent subscriptions reached (${MAX_CONCURRENT})`
    );
  });

  it("unsubscribeAll clears everything", () => {
    setReqId(301);
    const first = subscribe("realTimeBars", { symbol: "SPY" });
    setReqId(302);
    const second = subscribe("realTimeBars", { symbol: "QQQ" });

    unsubscribeAll();

    expect(cancelRealTimeBarsMock).toHaveBeenNthCalledWith(1, first);
    expect(cancelRealTimeBarsMock).toHaveBeenNthCalledWith(2, second);
    expect(activeSubscriptions.size).toBe(0);
  });

  it("reqScannerParameters returns parsed XML and caches it", async () => {
    reqScannerParametersMock.mockImplementation(() => {
      const cb = handlers.get("scannerParameters");
      if (!cb) {
        throw new Error("scannerParameters handler missing");
      }
      cb(`
        <Root>
          <instruments>STK</instruments>
          <instruments>FUT</instruments>
          <locationCode>STK.US.MAJOR</locationCode>
          <locationCode>FUT.US</locationCode>
          <scanCode>TOP_PERC_GAIN</scanCode>
          <scanCode>HOT_BY_VOLUME</scanCode>
        </Root>
      `);
    });

    const first = await getScannerParameters();
    const second = await getScannerParameters();

    expect(reqScannerParametersMock).toHaveBeenCalledTimes(1);
    expect(first.instrumentList).toEqual(["STK", "FUT"]);
    expect(first.locationCodeList).toEqual(["STK.US.MAJOR", "FUT.US"]);
    expect(first.scanTypeList).toEqual(["TOP_PERC_GAIN", "HOT_BY_VOLUME"]);
    expect(second).toEqual(first);
  });
});
