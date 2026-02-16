import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../config.js";

const mocks = vi.hoisted(() => ({
  reqMktData: vi.fn(),
  cancelMktData: vi.fn(),
  getNextReqId: vi.fn(),
}));

vi.mock("../connection.js", () => ({
  getIB: vi.fn(() => ({ reqMktData: mocks.reqMktData, cancelMktData: mocks.cancelMktData })),
  getNextReqId: mocks.getNextReqId,
}));

import {
  clearSubscriptionsForTests,
  getActiveCount,
  getSubscriptionStatus,
  subscribe,
  unsubscribe,
  getSymbolByTickerId,
} from "../subscriptions.js";

describe("subscriptions", () => {
  beforeEach(() => {
    clearSubscriptionsForTests();
    mocks.reqMktData.mockReset();
    mocks.cancelMktData.mockReset();
    mocks.getNextReqId.mockReset();
    config.ibkr.maxDataLines = 2;
  });

  it("subscribes symbols and tracks active count", () => {
    mocks.getNextReqId.mockReturnValueOnce(101).mockReturnValueOnce(102);

    const one = subscribe("AAPL", "watchlist");
    const two = subscribe("MSFT", "scanner");

    expect(one.tickerId).toBe(101);
    expect(two.tickerId).toBe(102);
    expect(getActiveCount()).toBe(2);
    expect(mocks.reqMktData).toHaveBeenCalledTimes(2);
    expect(getSymbolByTickerId(101)).toBe("AAPL");
  });

  it("evicts lower-priority LRU subscription when at capacity", () => {
    mocks.getNextReqId.mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3);

    subscribe("QQQ", "watchlist");
    subscribe("TSLA", "scanner");

    const third = subscribe("SPY", "open_positions");

    expect(third.evictedSymbol).toBe("TSLA");
    expect(mocks.cancelMktData).toHaveBeenCalledWith(2);
    expect(getSubscriptionStatus().subscriptions.map((s) => s.symbol).sort()).toEqual(["QQQ", "SPY"]);
  });

  it("unsubscribes existing symbols and no-ops unknown symbols", () => {
    mocks.getNextReqId.mockReturnValueOnce(11);
    subscribe("AMD", "watchlist");

    expect(unsubscribe("AMD")).toBe(true);
    expect(mocks.cancelMktData).toHaveBeenCalledWith(11);
    expect(unsubscribe("AMD")).toBe(false);
  });
});
