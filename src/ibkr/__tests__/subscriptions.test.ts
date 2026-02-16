import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { EventName } from "@stoqey/ib";

// ── Mock setup ──────────────────────────────────────────────────────────────

let nextId = 100;

function createMockIB() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    reqRealTimeBars: vi.fn(),
    cancelRealTimeBars: vi.fn(),
    reqAccountUpdates: vi.fn(),
    reqScannerParameters: vi.fn(),
  });
}

let mockIB: ReturnType<typeof createMockIB>;

vi.mock("../connection.js", () => ({
  getIB: () => mockIB,
  getNextReqId: () => nextId++,
  isConnected: () => true,
  onReconnect: vi.fn(),
}));

vi.mock("../../logging.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    }),
  },
}));

import {
  subscribeRealTimeBars,
  unsubscribeRealTimeBars,
  getRealTimeBars,
  subscribeAccountUpdates,
  unsubscribeAccountUpdates,
  getAccountSnapshot,
  getScannerParameters,
  listSubscriptions,
  unsubscribeAll,
  resubscribeAll,
  _resetForTesting,
} from "../subscriptions.js";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("SubscriptionManager", () => {
  beforeEach(() => {
    mockIB = createMockIB();
    nextId = 100;
    _resetForTesting();
  });

  // ── Real-Time Bars ──────────────────────────────────────────────────────

  describe("Real-Time Bars", () => {
    it("should subscribe and return subscription info", () => {
      const info = subscribeRealTimeBars({ symbol: "AAPL" });
      expect(info.id).toBeTruthy();
      expect(info.type).toBe("realTimeBars");
      expect(info.symbol).toBe("AAPL");
      expect(info.reqId).toBe(100);
      expect(info.barCount).toBe(0);
      expect(mockIB.reqRealTimeBars).toHaveBeenCalledWith(
        100, expect.objectContaining({ symbol: "AAPL" }), 5, "TRADES", true,
      );
    });

    it("should receive bars via realtimeBar event", () => {
      const info = subscribeRealTimeBars({ symbol: "AAPL" });
      // Emit a bar (individual params, NOT object)
      mockIB.emit(
        EventName.realtimeBar,
        100, 1708000000, 150.0, 151.0, 149.5, 150.5, 1000, 150.25, 50,
      );
      const bars = getRealTimeBars(info.id);
      expect(bars).toHaveLength(1);
      expect(bars[0]).toEqual({
        time: 1708000000, open: 150.0, high: 151.0, low: 149.5,
        close: 150.5, volume: 1000, wap: 150.25, count: 50,
      });
    });

    it("should buffer bars up to limit and trim oldest", () => {
      const info = subscribeRealTimeBars({ symbol: "AAPL" });
      // Push 310 bars (buffer is 300)
      for (let i = 0; i < 310; i++) {
        mockIB.emit(EventName.realtimeBar, 100, i, 100, 101, 99, 100.5, 500, 100.2, 10);
      }
      const bars = getRealTimeBars(info.id, 300);
      expect(bars).toHaveLength(300);
      // Oldest bar should be #10 (0-9 trimmed)
      expect(bars[0].time).toBe(10);
      expect(bars[299].time).toBe(309);
    });

    it("should deduplicate same symbol+exchange", () => {
      const info1 = subscribeRealTimeBars({ symbol: "AAPL" });
      const info2 = subscribeRealTimeBars({ symbol: "AAPL" });
      expect(info1.id).toBe(info2.id);
      expect(mockIB.reqRealTimeBars).toHaveBeenCalledTimes(1);
    });

    it("should enforce max subscription limit", () => {
      // Subscribe 50
      for (let i = 0; i < 50; i++) {
        subscribeRealTimeBars({ symbol: `SYM${i}` });
      }
      expect(() => subscribeRealTimeBars({ symbol: "OVERFLOW" }))
        .toThrow(/Max 50/);
    });

    it("should unsubscribe and clean up", () => {
      const info = subscribeRealTimeBars({ symbol: "AAPL" });
      const removed = unsubscribeRealTimeBars(info.id);
      expect(removed).toBe(true);
      expect(mockIB.cancelRealTimeBars).toHaveBeenCalledWith(100);
      expect(listSubscriptions()).toHaveLength(0);
    });

    it("should ignore bars for wrong reqId", () => {
      const info = subscribeRealTimeBars({ symbol: "AAPL" });
      // Emit bar with different reqId
      mockIB.emit(EventName.realtimeBar, 999, 1708000000, 150, 151, 149, 150.5, 1000, 150.25, 50);
      expect(getRealTimeBars(info.id)).toHaveLength(0);
    });

    it("should return limited bars via getRealTimeBars", () => {
      const info = subscribeRealTimeBars({ symbol: "AAPL" });
      for (let i = 0; i < 20; i++) {
        mockIB.emit(EventName.realtimeBar, 100, i, 100, 101, 99, 100, 500, 100, 10);
      }
      const bars = getRealTimeBars(info.id, 5);
      expect(bars).toHaveLength(5);
      expect(bars[0].time).toBe(15); // last 5
    });

    it("should throw when getting bars for unknown subscription", () => {
      expect(() => getRealTimeBars("nonexistent")).toThrow(/not found/);
    });
  });

  // ── Account Updates ───────────────────────────────────────────────────

  describe("Account Updates", () => {
    it("should subscribe and receive account values", () => {
      const info = subscribeAccountUpdates("DUA482209");
      expect(info.id).toBe("acct-DUA482209");
      expect(info.type).toBe("accountUpdates");
      expect(mockIB.reqAccountUpdates).toHaveBeenCalledWith(true, "DUA482209");

      // Emit account value
      mockIB.emit(EventName.updateAccountValue, "DUA482209", "NetLiquidation", "100000", "CAD");
      const snap = getAccountSnapshot();
      expect(snap).not.toBeNull();
      expect(snap!.values["NetLiquidation"]).toEqual({ value: "100000", currency: "CAD" });
    });

    it("should receive portfolio updates", () => {
      subscribeAccountUpdates("DUA482209");
      // Emit portfolio update — (account, contract, pos, mktPrice, mktValue, avgCost, unrealizedPnL, realizedPnL)
      mockIB.emit(
        EventName.updatePortfolio, "DUA482209",
        { symbol: "AAPL", secType: "STK", exchange: "SMART", currency: "USD" },
        10, 150.0, 1500.0, 145.0, 50.0, 0.0,
      );
      const snap = getAccountSnapshot()!;
      expect(snap.portfolio).toHaveLength(1);
      expect(snap.portfolio[0].symbol).toBe("AAPL");
      expect(snap.portfolio[0].position).toBe(10);
      expect(snap.portfolio[0].unrealizedPnL).toBe(50.0);
    });

    it("should reject second account subscription", () => {
      subscribeAccountUpdates("DUA482209");
      expect(() => subscribeAccountUpdates("OTHER_ACCT"))
        .toThrow(/Already subscribed/);
    });

    it("should return existing sub for same account", () => {
      const info1 = subscribeAccountUpdates("DUA482209");
      const info2 = subscribeAccountUpdates("DUA482209");
      expect(info1.id).toBe(info2.id);
    });

    it("should allow re-subscribe after unsubscribe", () => {
      subscribeAccountUpdates("DUA482209");
      const removed = unsubscribeAccountUpdates();
      expect(removed).toBe(true);
      expect(mockIB.reqAccountUpdates).toHaveBeenCalledWith(false, "DUA482209");

      // Now subscribe again
      const info = subscribeAccountUpdates("OTHER_ACCT");
      expect(info.account).toBe("OTHER_ACCT");
    });

    it("should ignore events for wrong account", () => {
      subscribeAccountUpdates("DUA482209");
      mockIB.emit(EventName.updateAccountValue, "OTHER_ACCT", "Cash", "999", "USD");
      const snap = getAccountSnapshot()!;
      expect(snap.values["Cash"]).toBeUndefined();
    });
  });

  // ── Scanner Parameters ────────────────────────────────────────────────

  describe("Scanner Parameters", () => {
    it("should fetch scanner parameters", async () => {
      const promise = getScannerParameters();
      // Emit scanner parameters
      mockIB.emit(EventName.scannerParameters, "<xml>scanner</xml>");
      const xml = await promise;
      expect(xml).toBe("<xml>scanner</xml>");
    });

    it("should return cached result within TTL", async () => {
      const p1 = getScannerParameters();
      mockIB.emit(EventName.scannerParameters, "<xml>cached</xml>");
      await p1;

      // Second call should return cached (no new reqScannerParameters call)
      const callCountBefore = mockIB.reqScannerParameters.mock.calls.length;
      const xml = await getScannerParameters();
      expect(xml).toBe("<xml>cached</xml>");
      expect(mockIB.reqScannerParameters).toHaveBeenCalledTimes(callCountBefore);
    });

    it("should timeout after 30s", async () => {
      vi.useFakeTimers();
      const promise = getScannerParameters();
      vi.advanceTimersByTime(31000);
      await expect(promise).rejects.toThrow(/timed out/);
      vi.useRealTimers();
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────

  describe("Lifecycle", () => {
    it("should list all active subscriptions", () => {
      subscribeRealTimeBars({ symbol: "AAPL" });
      subscribeRealTimeBars({ symbol: "MSFT" });
      subscribeAccountUpdates("DUA482209");
      const subs = listSubscriptions();
      expect(subs).toHaveLength(3);
      expect(subs.filter((s) => s.type === "realTimeBars")).toHaveLength(2);
      expect(subs.filter((s) => s.type === "accountUpdates")).toHaveLength(1);
    });

    it("should unsubscribeAll and clean everything", () => {
      subscribeRealTimeBars({ symbol: "AAPL" });
      subscribeRealTimeBars({ symbol: "MSFT" });
      subscribeAccountUpdates("DUA482209");
      unsubscribeAll();
      expect(listSubscriptions()).toHaveLength(0);
      expect(getAccountSnapshot()).toBeNull();
    });

    it("should resubscribeAll with new reqIds", () => {
      subscribeRealTimeBars({ symbol: "AAPL" });
      const originalId = listSubscriptions()[0].id;
      const originalReqId = listSubscriptions()[0].reqId;

      // Simulate reconnect
      resubscribeAll();

      const subs = listSubscriptions();
      expect(subs).toHaveLength(1);
      // Same subscription ID (client-facing)
      expect(subs[0].id).toBe(originalId);
      // Different reqId (IBKR-internal)
      expect(subs[0].reqId).not.toBe(originalReqId);
      // New reqRealTimeBars call was made
      expect(mockIB.reqRealTimeBars).toHaveBeenCalledTimes(2);
    });
  });
});
