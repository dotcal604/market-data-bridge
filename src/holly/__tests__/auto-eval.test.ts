import { describe, it, expect, beforeEach, vi } from "vitest";
import { _testing, isAutoEvalEnabled, setAutoEvalEnabled, getAutoEvalStatus, processNewAlerts } from "../auto-eval.js";
import { db, insertSignal, querySignals, getSignalStats, hasRecentEvalForSymbol, getHollyAlertsByBatch } from "../../db/database.js";
import { importHollyAlerts } from "../importer.js";

const { inferDirection, DIRECTION_MAP } = _testing;

// ── Helpers ──────────────────────────────────────────────────────────────

function clearTables(): void {
  db.exec("DELETE FROM signals");
  db.exec("DELETE FROM holly_alerts");
  db.exec("DELETE FROM evaluations");
}

const HEADER = "Entry Time,Symbol,Strategy,Entry Price,Stop Price,Shares,Last Price,Segment";

function makeRow(symbol: string, time: string, strategy = "Holly Grail", price = "150.00"): string {
  return `${time},${symbol},${strategy},${price},145.00,100,${price},${strategy}`;
}

// ── Direction Inference Tests ────────────────────────────────────────────

describe("inferDirection", () => {
  it("defaults to long when strategy is null/undefined", () => {
    expect(inferDirection(null)).toBe("long");
    expect(inferDirection(undefined)).toBe("long");
    expect(inferDirection("")).toBe("long");
  });

  it("detects long strategies", () => {
    expect(inferDirection("Bull Flag")).toBe("long");
    expect(inferDirection("Breakout")).toBe("long");
    expect(inferDirection("Momentum Play")).toBe("long");
    expect(inferDirection("Gap Up Runner")).toBe("long");
    expect(inferDirection("Long Squeeze")).toBe("long");
  });

  it("detects short strategies", () => {
    expect(inferDirection("Bear Flag")).toBe("short");
    expect(inferDirection("Short Squeeze Fade")).toBe("short");
    expect(inferDirection("Put Breakdown")).toBe("short");
    expect(inferDirection("Breakdown Pattern")).toBe("short");
  });

  it("is case-insensitive", () => {
    expect(inferDirection("BULL FLAG")).toBe("long");
    expect(inferDirection("bear flag")).toBe("short");
    expect(inferDirection("BREAKOUT")).toBe("long");
  });

  it("defaults unknown strategies to long", () => {
    expect(inferDirection("Holly Grail")).toBe("long");
    expect(inferDirection("Unknown Strategy")).toBe("long");
  });
});

// ── Auto-Eval Toggle Tests ──────────────────────────────────────────────

describe("Auto-Eval Toggle", () => {
  it("reports enabled/disabled status", () => {
    const original = isAutoEvalEnabled();
    setAutoEvalEnabled(true);
    expect(isAutoEvalEnabled()).toBe(true);
    setAutoEvalEnabled(false);
    expect(isAutoEvalEnabled()).toBe(false);
    // restore
    setAutoEvalEnabled(original);
  });

  it("getAutoEvalStatus returns config details", () => {
    const status = getAutoEvalStatus();
    expect(status).toHaveProperty("enabled");
    expect(status).toHaveProperty("running");
    expect(status).toHaveProperty("maxConcurrent");
    expect(status).toHaveProperty("dedupWindowMin");
    expect(typeof status.running).toBe("number");
    expect(typeof status.maxConcurrent).toBe("number");
  });
});

// ── Signal DB Layer Tests ───────────────────────────────────────────────

describe("Signal DB Functions", () => {
  beforeEach(() => clearTables());

  it("insertSignal and querySignals round-trip", () => {
    const id = insertSignal({
      holly_alert_id: null,
      evaluation_id: "test-eval-1",
      symbol: "AAPL",
      direction: "long",
      strategy: "Bull Flag",
      ensemble_score: 72.5,
      should_trade: 1,
      prefilter_passed: 1,
    });
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);

    const signals = querySignals({ symbol: "AAPL" });
    expect(signals).toHaveLength(1);
    expect(signals[0].symbol).toBe("AAPL");
    expect(signals[0].direction).toBe("long");
    expect(signals[0].ensemble_score).toBe(72.5);
  });

  it("querySignals filters by direction", () => {
    insertSignal({ holly_alert_id: null, evaluation_id: "e1", symbol: "AAPL", direction: "long", strategy: null, ensemble_score: 70, should_trade: 1, prefilter_passed: 1 });
    insertSignal({ holly_alert_id: null, evaluation_id: "e2", symbol: "TSLA", direction: "short", strategy: null, ensemble_score: 65, should_trade: 1, prefilter_passed: 1 });

    const longSignals = querySignals({ direction: "long" });
    expect(longSignals).toHaveLength(1);
    expect(longSignals[0].symbol).toBe("AAPL");

    const shortSignals = querySignals({ direction: "short" });
    expect(shortSignals).toHaveLength(1);
    expect(shortSignals[0].symbol).toBe("TSLA");
  });

  it("getSignalStats returns aggregate counts", () => {
    insertSignal({ holly_alert_id: null, evaluation_id: "e1", symbol: "AAPL", direction: "long", strategy: null, ensemble_score: 72, should_trade: 1, prefilter_passed: 1 });
    insertSignal({ holly_alert_id: null, evaluation_id: "e2", symbol: "TSLA", direction: "short", strategy: null, ensemble_score: 30, should_trade: 0, prefilter_passed: 0 });

    const stats = getSignalStats();
    expect(stats.total_signals).toBe(2);
  });

  it("querySignals respects limit", () => {
    for (let i = 0; i < 10; i++) {
      insertSignal({ holly_alert_id: null, evaluation_id: `e${i}`, symbol: `SYM${i}`, direction: "long", strategy: null, ensemble_score: i * 10, should_trade: 1, prefilter_passed: 1 });
    }

    const limited = querySignals({ limit: 3 });
    expect(limited).toHaveLength(3);
  });
});

// ── Dedup Tests ─────────────────────────────────────────────────────────

describe("hasRecentEvalForSymbol", () => {
  beforeEach(() => clearTables());

  it("returns false when no recent eval exists", () => {
    expect(hasRecentEvalForSymbol("AAPL", 5)).toBe(false);
  });

  it("returns true when a recent signal exists", () => {
    insertSignal({ holly_alert_id: null, evaluation_id: "e1", symbol: "AAPL", direction: "long", strategy: null, ensemble_score: 70, should_trade: 1, prefilter_passed: 1 });
    expect(hasRecentEvalForSymbol("AAPL", 5)).toBe(true);
  });

  it("is case-insensitive for symbol", () => {
    insertSignal({ holly_alert_id: null, evaluation_id: "e1", symbol: "AAPL", direction: "long", strategy: null, ensemble_score: 70, should_trade: 1, prefilter_passed: 1 });
    expect(hasRecentEvalForSymbol("aapl", 5)).toBe(true);
  });
});

// ── getHollyAlertsByBatch Tests ─────────────────────────────────────────

describe("getHollyAlertsByBatch", () => {
  beforeEach(() => clearTables());

  it("returns alerts for a given batch", () => {
    const csv = [HEADER, makeRow("AAPL", "2026-02-17 10:00:00"), makeRow("MSFT", "2026-02-17 10:05:00")].join("\n");
    const result = importHollyAlerts(csv);
    expect(result.inserted).toBe(2);

    const alerts = getHollyAlertsByBatch(result.batch_id);
    expect(alerts).toHaveLength(2);
    const symbols = alerts.map((a) => a.symbol);
    expect(symbols).toContain("AAPL");
    expect(symbols).toContain("MSFT");
  });

  it("returns empty array for unknown batch", () => {
    const alerts = getHollyAlertsByBatch("nonexistent-batch");
    expect(alerts).toHaveLength(0);
  });
});

// ── processNewAlerts Skips When Disabled ─────────────────────────────────

describe("processNewAlerts", () => {
  beforeEach(() => {
    clearTables();
    setAutoEvalEnabled(false);
  });

  it("returns zeros when disabled", async () => {
    const result = await processNewAlerts({ batch_id: "b1", total_parsed: 5, inserted: 5, skipped: 0, errors: [] });
    expect(result).toEqual({ evaluated: 0, skipped: 0, errors: 0 });
  });

  it("returns zeros when no rows inserted", async () => {
    setAutoEvalEnabled(true);
    const result = await processNewAlerts({ batch_id: "b1", total_parsed: 0, inserted: 0, skipped: 0, errors: [] });
    expect(result).toEqual({ evaluated: 0, skipped: 0, errors: 0 });
  });
});
