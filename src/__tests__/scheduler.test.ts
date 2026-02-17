import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startScheduler,
  stopScheduler,
  setFlattenEnabled,
  getFlattenConfig,
  getLastDriftState,
} from "../scheduler.js";

// Mock IBKR connection
vi.mock("../ibkr/connection.js", () => ({
  isConnected: vi.fn(() => true),
}));

// Mock IBKR account functions
vi.mock("../ibkr/account.js", () => ({
  getAccountSummary: vi.fn(async () => ({
    account: "TEST123",
    netLiquidation: 100000,
    totalCashValue: 50000,
    settledCash: 50000,
    buyingPower: 200000,
    grossPositionValue: 50000,
    maintMarginReq: 10000,
    excessLiquidity: 90000,
    availableFunds: 90000,
    currency: "USD",
    timestamp: new Date().toISOString(),
  })),
  getPositions: vi.fn(async () => [
    { symbol: "AAPL", position: 100, avgCost: 150.0 },
    { symbol: "TSLA", position: 50, avgCost: 200.0 },
  ]),
}));

// Mock IBKR orders
vi.mock("../ibkr/orders.js", () => ({
  flattenAllPositions: vi.fn(async () => ({
    flattened: [{ symbol: "AAPL" }, { symbol: "TSLA" }],
    skipped: [],
  })),
}));

// Mock database functions
vi.mock("../db/database.js", () => ({
  insertAccountSnapshot: vi.fn(),
  insertPositionSnapshot: vi.fn(),
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
    })),
  })),
}));

// Mock eval drift functions
vi.mock("../eval/drift.js", () => ({
  computeDriftReport: vi.fn(() => ({
    overall_accuracy: 0.65,
    by_model: [
      {
        model_id: "claude-sonnet",
        sample_size: 50,
        rolling_accuracy: { last_50: 0.65, last_20: 0.60, last_10: 0.55 },
        calibration_error: 0.10,
        calibration_by_decile: [],
        regime_shift_detected: false,
      },
    ],
    regime_shift_detected: false,
    recommendation: "Monitor",
  })),
}));

// Mock drift alerts
vi.mock("../eval/drift-alerts.js", () => ({
  checkDriftAlerts: vi.fn(() => []),
}));

// Mock tunnel monitor
vi.mock("../ops/tunnel-monitor.js", () => ({
  checkTunnelHealth: vi.fn(async () => {}),
}));

// Mock logger
vi.mock("../logging.js", () => ({
  logger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

describe("Scheduler", () => {
  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    // Use fake timers for time control
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Stop scheduler to clean up timers
    stopScheduler();
    // Restore real timers
    vi.useRealTimers();
  });

  describe("startScheduler() and stopScheduler()", () => {
    it("should create timers when startScheduler() is called", () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");

      startScheduler(5 * 60 * 1000); // 5 minutes

      // Should create 5 intervals: snapshot, flatten, drift, inbox prune, tunnel
      expect(setIntervalSpy).toHaveBeenCalledTimes(5);

      // Should create 3 timeouts: initial drift check (60s) + initial prune check (30s) + initial tunnel check (30s)
      expect(setTimeoutSpy).toHaveBeenCalledTimes(3);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    });

    it("should clear all timers when stopScheduler() is called", () => {
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      startScheduler();
      stopScheduler();

      // Should clear 5 intervals: snapshot, flatten, drift, inbox prune, tunnel
      expect(clearIntervalSpy).toHaveBeenCalledTimes(5);
    });

    it("should not create duplicate timers if startScheduler() called twice", () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");

      startScheduler();
      const firstCallCount = setIntervalSpy.mock.calls.length;
      
      startScheduler();
      const secondCallCount = setIntervalSpy.mock.calls.length;

      // Should not create additional timers
      expect(secondCallCount).toBe(firstCallCount);
    });
  });

  describe("Snapshot during market hours", () => {
    it("should take snapshot during market hours (9:30 AM ET, Monday)", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { getAccountSummary, getPositions } = await import("../ibkr/account.js");
      const { insertAccountSnapshot, insertPositionSnapshot } = await import("../db/database.js");

      // Set system time to Monday 9:30 AM ET (14:30 UTC)
      const monday930ET = new Date("2024-02-05T14:30:00.000Z"); // Monday
      vi.setSystemTime(monday930ET);

      vi.mocked(isConnected).mockReturnValue(true);

      startScheduler(5 * 60 * 1000);

      // Fast-forward to trigger the interval
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(getAccountSummary).toHaveBeenCalled();
      expect(getPositions).toHaveBeenCalled();
      expect(insertAccountSnapshot).toHaveBeenCalled();
      expect(insertPositionSnapshot).toHaveBeenCalled();
    });

    it("should take snapshot during pre-market hours (6 AM ET, Wednesday)", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { getAccountSummary, getPositions } = await import("../ibkr/account.js");
      const { insertAccountSnapshot, insertPositionSnapshot } = await import("../db/database.js");

      // Set system time to Wednesday 6:00 AM ET (11:00 UTC)
      const wednesday6ET = new Date("2024-02-07T11:00:00.000Z"); // Wednesday
      vi.setSystemTime(wednesday6ET);

      vi.mocked(isConnected).mockReturnValue(true);

      startScheduler(5 * 60 * 1000);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(getAccountSummary).toHaveBeenCalled();
      expect(getPositions).toHaveBeenCalled();
      expect(insertAccountSnapshot).toHaveBeenCalled();
      expect(insertPositionSnapshot).toHaveBeenCalled();
    });

    it("should take snapshot during after-hours (6 PM ET, Friday)", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { getAccountSummary, getPositions } = await import("../ibkr/account.js");
      const { insertAccountSnapshot, insertPositionSnapshot } = await import("../db/database.js");

      // Set system time to Friday 6:00 PM ET (23:00 UTC)
      const friday6pmET = new Date("2024-02-09T23:00:00.000Z"); // Friday
      vi.setSystemTime(friday6pmET);

      vi.mocked(isConnected).mockReturnValue(true);

      startScheduler(5 * 60 * 1000);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(getAccountSummary).toHaveBeenCalled();
      expect(getPositions).toHaveBeenCalled();
      expect(insertAccountSnapshot).toHaveBeenCalled();
      expect(insertPositionSnapshot).toHaveBeenCalled();
    });
  });

  describe("Snapshot skips weekends and off-hours", () => {
    it("should skip snapshot on Saturday", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { getAccountSummary } = await import("../ibkr/account.js");

      // Set system time to Saturday 10:00 AM ET
      const saturday10ET = new Date("2024-02-10T15:00:00.000Z"); // Saturday
      vi.setSystemTime(saturday10ET);

      vi.mocked(isConnected).mockReturnValue(true);

      startScheduler(5 * 60 * 1000);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(getAccountSummary).not.toHaveBeenCalled();
    });

    it("should skip snapshot on Sunday", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { getAccountSummary } = await import("../ibkr/account.js");

      // Set system time to Sunday 10:00 AM ET
      const sunday10ET = new Date("2024-02-11T15:00:00.000Z"); // Sunday
      vi.setSystemTime(sunday10ET);

      vi.mocked(isConnected).mockReturnValue(true);

      startScheduler(5 * 60 * 1000);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(getAccountSummary).not.toHaveBeenCalled();
    });

    it("should skip snapshot before 4:00 AM ET (2 AM ET)", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { getAccountSummary } = await import("../ibkr/account.js");

      // Set system time to Monday 2:00 AM ET (7:00 UTC)
      const monday2ET = new Date("2024-02-05T07:00:00.000Z"); // Monday 2 AM ET
      vi.setSystemTime(monday2ET);

      vi.mocked(isConnected).mockReturnValue(true);

      startScheduler(5 * 60 * 1000);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(getAccountSummary).not.toHaveBeenCalled();
    });

    it("should skip snapshot after 8:00 PM ET (9 PM ET)", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { getAccountSummary } = await import("../ibkr/account.js");

      // Set system time to Monday 9:00 PM ET (2:00 UTC next day)
      const monday9pmET = new Date("2024-02-06T02:00:00.000Z"); // Monday 9 PM ET
      vi.setSystemTime(monday9pmET);

      vi.mocked(isConnected).mockReturnValue(true);

      startScheduler(5 * 60 * 1000);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(getAccountSummary).not.toHaveBeenCalled();
    });

    it("should not take snapshot when IBKR is disconnected", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { getAccountSummary } = await import("../ibkr/account.js");

      // Set system time to Monday 10:00 AM ET
      const monday10ET = new Date("2024-02-05T15:00:00.000Z");
      vi.setSystemTime(monday10ET);

      vi.mocked(isConnected).mockReturnValue(false);

      startScheduler(5 * 60 * 1000);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(getAccountSummary).not.toHaveBeenCalled();
    });
  });

  describe("EOD Flatten at 15:55 ET", () => {
    it("should trigger flatten at 15:55 ET on Monday", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { flattenAllPositions } = await import("../ibkr/orders.js");

      // Set system time to Monday 15:54:30 ET (just before flatten time)
      const monday1554ET = new Date("2024-02-05T20:54:30.000Z");
      vi.setSystemTime(monday1554ET);

      vi.mocked(isConnected).mockReturnValue(true);
      setFlattenEnabled(true);

      startScheduler();

      // Advance to 15:55:00 ET (flatten check runs every 30s)
      await vi.advanceTimersByTimeAsync(30_000);

      expect(flattenAllPositions).toHaveBeenCalled();
    });

    it("should not trigger flatten twice on same day", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { flattenAllPositions } = await import("../ibkr/orders.js");

      // Use a different date than other tests to avoid state collision
      // Set system time to Wednesday 15:54:30 ET (before flatten time)
      const wednesday1554ET = new Date("2024-02-07T20:54:30.000Z"); // Wednesday
      vi.setSystemTime(wednesday1554ET);

      vi.mocked(isConnected).mockReturnValue(true);
      setFlattenEnabled(true);

      startScheduler();

      // First trigger - advance to 15:55:00 ET
      await vi.advanceTimersByTimeAsync(30_000);
      expect(flattenAllPositions).toHaveBeenCalledTimes(1);

      // Advance another 30s (still same day, now 15:55:30)
      await vi.advanceTimersByTimeAsync(30_000);
      expect(flattenAllPositions).toHaveBeenCalledTimes(1); // Should not increment

      // Advance to 15:56:00 (still same day)
      await vi.advanceTimersByTimeAsync(30_000);
      expect(flattenAllPositions).toHaveBeenCalledTimes(1); // Should still not increment
    });

    it("should reset flatten for new trading day", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { flattenAllPositions } = await import("../ibkr/orders.js");

      // Use Thursday/Friday to avoid collision with other test dates
      // Start on Thursday 15:54:30 ET (just before flatten time)
      const thursday1554ET = new Date("2024-02-08T20:54:30.000Z"); // Thursday
      vi.setSystemTime(thursday1554ET);

      vi.mocked(isConnected).mockReturnValue(true);
      setFlattenEnabled(true);

      startScheduler();

      // First trigger on Thursday - advance to 15:55:00
      await vi.advanceTimersByTimeAsync(30_000);
      expect(flattenAllPositions).toHaveBeenCalledTimes(1);

      // Move to Friday 15:54:30 ET (next day, before flatten time)
      const friday1554ET = new Date("2024-02-09T20:54:30.000Z"); // Friday
      vi.setSystemTime(friday1554ET);

      // Trigger again - advance to 15:55:00, should fire for new day
      await vi.advanceTimersByTimeAsync(30_000);
      expect(flattenAllPositions).toHaveBeenCalledTimes(2);
    });

    it("should not trigger flatten on weekends", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { flattenAllPositions } = await import("../ibkr/orders.js");

      // Set system time to Saturday 15:55 ET
      const saturday1555ET = new Date("2024-02-10T20:55:00.000Z");
      vi.setSystemTime(saturday1555ET);

      vi.mocked(isConnected).mockReturnValue(true);
      setFlattenEnabled(true);

      startScheduler();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(flattenAllPositions).not.toHaveBeenCalled();
    });

    it("should not trigger flatten when disabled", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { flattenAllPositions } = await import("../ibkr/orders.js");

      // Set system time to Monday 15:55 ET
      const monday1555ET = new Date("2024-02-05T20:55:00.000Z");
      vi.setSystemTime(monday1555ET);

      vi.mocked(isConnected).mockReturnValue(true);
      setFlattenEnabled(false); // Disable flatten

      startScheduler();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(flattenAllPositions).not.toHaveBeenCalled();
    });

    it("should not trigger flatten when IBKR disconnected", async () => {
      const { isConnected } = await import("../ibkr/connection.js");
      const { flattenAllPositions } = await import("../ibkr/orders.js");

      // Set system time to Monday 15:55 ET
      const monday1555ET = new Date("2024-02-05T20:55:00.000Z");
      vi.setSystemTime(monday1555ET);

      vi.mocked(isConnected).mockReturnValue(false);
      setFlattenEnabled(true);

      startScheduler();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(flattenAllPositions).not.toHaveBeenCalled();
    });
  });

  describe("Drift check every 30 minutes", () => {
    it("should run drift check during market hours", async () => {
      const { computeDriftReport } = await import("../eval/drift.js");
      const { checkDriftAlerts } = await import("../eval/drift-alerts.js");

      // Set system time to Monday 10:00 AM ET
      const monday10ET = new Date("2024-02-05T15:00:00.000Z");
      vi.setSystemTime(monday10ET);

      startScheduler();

      // Initial check after 60s
      await vi.advanceTimersByTimeAsync(60_000);
      expect(computeDriftReport).toHaveBeenCalledTimes(1);
      expect(checkDriftAlerts).toHaveBeenCalledTimes(1);

      // Next check after 30 minutes
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(computeDriftReport).toHaveBeenCalledTimes(2);
      expect(checkDriftAlerts).toHaveBeenCalledTimes(2);
    });

    it("should skip drift check off-hours (2 AM ET)", async () => {
      const { computeDriftReport } = await import("../eval/drift.js");
      const { checkDriftAlerts } = await import("../eval/drift-alerts.js");

      // Set system time to Monday 2:00 AM ET (off-hours)
      const monday2ET = new Date("2024-02-05T07:00:00.000Z");
      vi.setSystemTime(monday2ET);

      // Get initial drift state from previous tests (may be set)
      const initialState = getLastDriftState();

      startScheduler();

      // Initial check after 60s (should return early and not call computeDriftReport)
      await vi.advanceTimersByTimeAsync(60_000);

      // computeDriftReport should not be called because isMarketActive() returns false
      // Note: it might have been called from previous tests that are still in module state
      // So we check that it wasn't called DURING this test by checking the call count didn't increase
      const callsBeforeNextInterval = vi.mocked(computeDriftReport).mock.calls.length;

      // Advance another 30 min interval (still off-hours)
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      
      // Call count should not have increased during off-hours
      expect(vi.mocked(computeDriftReport).mock.calls.length).toBe(callsBeforeNextInterval);
      expect(vi.mocked(checkDriftAlerts).mock.calls.length).toBe(0);
      
      // Drift state should not have changed from initial state
      expect(getLastDriftState()).toEqual(initialState);
    });

    it("should skip drift check on weekends", async () => {
      const { computeDriftReport } = await import("../eval/drift.js");
      const { checkDriftAlerts } = await import("../eval/drift-alerts.js");

      // Set system time to Saturday 10:00 AM ET (weekend)
      const saturday10ET = new Date("2024-02-10T15:00:00.000Z");
      vi.setSystemTime(saturday10ET);

      // Get initial drift state from previous tests (may be set)
      const initialState = getLastDriftState();

      startScheduler();

      // Initial check after 60s (should return early and not call computeDriftReport)
      await vi.advanceTimersByTimeAsync(60_000);

      // Clear mocks to track calls from this point forward
      vi.mocked(computeDriftReport).mockClear();
      vi.mocked(checkDriftAlerts).mockClear();

      // Advance another 30 min interval (still weekend)
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

      // computeDriftReport should not be called because isMarketActive() returns false on weekends
      expect(vi.mocked(computeDriftReport)).not.toHaveBeenCalled();
      expect(vi.mocked(checkDriftAlerts)).not.toHaveBeenCalled();

      // Drift state should not have changed from initial state
      expect(getLastDriftState()).toEqual(initialState);
    });

    it("should update last drift state on successful check", async () => {
      const { computeDriftReport } = await import("../eval/drift.js");

      // Set system time to Monday 10:00 AM ET (during market hours)
      const monday10ET = new Date("2024-02-05T15:00:00.000Z");
      vi.setSystemTime(monday10ET);

      vi.mocked(computeDriftReport).mockReturnValue({
        overall_accuracy: 0.72,
        by_model: [],
        regime_shift_detected: false,
        recommendation: "Monitor",
      });

      startScheduler();

      // Initial check after 60s
      await vi.advanceTimersByTimeAsync(60_000);

      const state = getLastDriftState();
      expect(state).not.toBeNull();
      expect(state?.overall_accuracy).toBe(0.72);
      expect(state?.regime_shift_detected).toBe(false);
    });
  });

  describe("getFlattenConfig()", () => {
    it("should return flatten configuration", () => {
      setFlattenEnabled(true);
      const config = getFlattenConfig();

      expect(config.enabled).toBe(true);
      expect(config.time).toBe("15:55 ET");
      // Note: firedToday may have a value if flatten was triggered in previous test
      // We can't reliably reset module state without vi.resetModules() which breaks mocks
      expect(typeof config.firedToday).toBe("string");
    });

    it("should reflect disabled state", () => {
      setFlattenEnabled(false);
      const config = getFlattenConfig();

      expect(config.enabled).toBe(false);
    });
  });
});
