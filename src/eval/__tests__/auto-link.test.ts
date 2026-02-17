import { describe, it, expect } from "vitest";
import {
  findMatchingEval,
  computeRMultiple,
  isPositionClosed,
  type EvalCandidate,
  type ExecutionRecord,
} from "../auto-link.js";

// ── findMatchingEval ──────────────────────────────────────────────────────

describe("findMatchingEval", () => {
  const baseExec: ExecutionRecord = {
    exec_id: "exec1",
    order_id: 100,
    symbol: "AAPL",
    side: "BOT",
    price: 150.0,
    timestamp: "2025-01-15T10:30:00.000Z",
  };

  const makeCandidate = (overrides: Partial<EvalCandidate> = {}): EvalCandidate => ({
    id: "eval1",
    symbol: "AAPL",
    direction: "long",
    entry_price: 150.0,
    stop_price: 148.0,
    timestamp: "2025-01-15T10:15:00.000Z", // 15 min before exec
    ensemble_should_trade: 1,
    ...overrides,
  });

  it("returns match for exact symbol+direction within window", () => {
    const result = findMatchingEval(baseExec, [makeCandidate()]);
    expect(result).not.toBeNull();
    expect(result!.eval.id).toBe("eval1");
    expect(result!.confidence).toBeGreaterThan(0.3);
  });

  it("returns null for wrong symbol", () => {
    const result = findMatchingEval(baseExec, [makeCandidate({ symbol: "MSFT" })]);
    expect(result).toBeNull();
  });

  it("returns null for wrong direction", () => {
    const result = findMatchingEval(baseExec, [makeCandidate({ direction: "short" })]);
    expect(result).toBeNull();
  });

  it("returns null for eval after execution", () => {
    const result = findMatchingEval(baseExec, [
      makeCandidate({ timestamp: "2025-01-15T11:00:00.000Z" }), // after exec
    ]);
    expect(result).toBeNull();
  });

  it("returns null for eval outside time window", () => {
    const result = findMatchingEval(baseExec, [
      makeCandidate({ timestamp: "2025-01-15T09:00:00.000Z" }), // 90 min before = outside 30min window
    ]);
    expect(result).toBeNull();
  });

  it("prefers closer timestamp", () => {
    const result = findMatchingEval(baseExec, [
      makeCandidate({ id: "eval_far", timestamp: "2025-01-15T10:05:00.000Z" }), // 25 min before
      makeCandidate({ id: "eval_close", timestamp: "2025-01-15T10:28:00.000Z" }), // 2 min before
    ]);
    expect(result).not.toBeNull();
    expect(result!.eval.id).toBe("eval_close");
  });

  it("gives price proximity bonus", () => {
    const result = findMatchingEval(baseExec, [
      makeCandidate({ id: "eval_far_price", entry_price: 140.0, timestamp: "2025-01-15T10:15:00.000Z" }),
      makeCandidate({ id: "eval_close_price", entry_price: 150.0, timestamp: "2025-01-15T10:15:00.000Z" }),
    ]);
    expect(result).not.toBeNull();
    expect(result!.eval.id).toBe("eval_close_price");
  });

  it("matches when eval has no direction", () => {
    const result = findMatchingEval(baseExec, [makeCandidate({ direction: null })]);
    expect(result).not.toBeNull();
  });

  it("returns null for empty candidates", () => {
    const result = findMatchingEval(baseExec, []);
    expect(result).toBeNull();
  });

  it("returns null for very weak match", () => {
    // Eval at the very edge of window with no price info
    const result = findMatchingEval(baseExec, [
      makeCandidate({
        timestamp: "2025-01-15T10:00:30.000Z", // 29.5 min before
        entry_price: null,
      }),
    ]);
    // Should still match (time score ~0.017 * 0.7 = ~0.012) but confidence < 0.1 = null
    // Actually: 30min - 29.5min = 0.5min. timeScore = 1 - (29.5*60*1000)/(30*60*1000) = 1 - 0.983 = 0.017
    // confidence = 0.017 * 0.7 = 0.012 → < 0.1 → null
    expect(result).toBeNull();
  });

  it("handles SLD execution as short direction", () => {
    const shortExec: ExecutionRecord = { ...baseExec, side: "SLD" };
    const result = findMatchingEval(shortExec, [makeCandidate({ direction: "short" })]);
    expect(result).not.toBeNull();
  });
});

// ── computeRMultiple ──────────────────────────────────────────────────────

describe("computeRMultiple", () => {
  it("computes positive R for long winner", () => {
    // Bought at 100, stop at 98, sold at 104 → (104-100)/(100-98) = 2R
    const r = computeRMultiple("long", 100, 104, 98);
    expect(r).toBe(2);
  });

  it("computes negative R for long loser", () => {
    // Bought at 100, stop at 98, sold at 97 → (97-100)/(100-98) = -1.5R
    const r = computeRMultiple("long", 100, 97, 98);
    expect(r).toBe(-1.5);
  });

  it("computes positive R for short winner", () => {
    // Shorted at 100, stop at 102, covered at 96 → (100-96)/(102-100) = 2R
    const r = computeRMultiple("short", 100, 96, 102);
    expect(r).toBe(2);
  });

  it("computes negative R for short loser", () => {
    // Shorted at 100, stop at 102, covered at 103 → (100-103)/(102-100) = -1.5R
    const r = computeRMultiple("short", 100, 103, 102);
    expect(r).toBe(-1.5);
  });

  it("returns null when stop equals entry (division by zero)", () => {
    const r = computeRMultiple("long", 100, 105, 100);
    expect(r).toBeNull();
  });

  it("returns 0R for breakeven trade", () => {
    const r = computeRMultiple("long", 100, 100, 98);
    expect(r).toBe(0);
  });
});

// ── isPositionClosed ──────────────────────────────────────────────────────

describe("isPositionClosed", () => {
  it("returns true for balanced buy/sell", () => {
    const result = isPositionClosed([
      { side: "BOT", shares: 100 },
      { side: "SLD", shares: 100 },
    ]);
    expect(result).toBe(true);
  });

  it("returns false for partial fill", () => {
    const result = isPositionClosed([
      { side: "BOT", shares: 100 },
      { side: "SLD", shares: 50 },
    ]);
    expect(result).toBe(false);
  });

  it("returns true for multiple fills netting to zero", () => {
    const result = isPositionClosed([
      { side: "BOT", shares: 50 },
      { side: "BOT", shares: 50 },
      { side: "SLD", shares: 30 },
      { side: "SLD", shares: 70 },
    ]);
    expect(result).toBe(true);
  });

  it("returns true for empty executions", () => {
    const result = isPositionClosed([]);
    expect(result).toBe(true);
  });

  it("returns false for only buys", () => {
    const result = isPositionClosed([
      { side: "BOT", shares: 100 },
    ]);
    expect(result).toBe(false);
  });

  it("handles floating point tolerance", () => {
    const result = isPositionClosed([
      { side: "BOT", shares: 100.0001 },
      { side: "SLD", shares: 100.0002 },
    ]);
    // Diff is 0.0001 which is < 0.001 tolerance
    expect(result).toBe(true);
  });
});
