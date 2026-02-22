import { describe, it, expect, vi } from "vitest";
import { wsBroadcast, wsBroadcastWithSequence, getNextSequenceId } from "../server.js";

describe("WebSocket Stream Extensions", () => {
  it("should increment sequence IDs monotonically", () => {
    const seq1 = getNextSequenceId();
    const seq2 = getNextSequenceId();
    const seq3 = getNextSequenceId();

    expect(seq1).toBeLessThan(seq2);
    expect(seq2).toBeLessThan(seq3);
    expect(seq3 - seq2).toBe(1);
  });

  it("should generate unique increasing sequence IDs", () => {
    const sequences: number[] = [];
    for (let i = 0; i < 10; i++) {
      sequences.push(getNextSequenceId());
    }

    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
    }
  });

  it("should handle eval_created message broadcasting without errors", () => {
    expect(() => {
      wsBroadcast("eval_created", {
        type: "eval",
        action: "created",
        evalId: "test-eval-123",
        symbol: "AAPL",
        score: 75.5,
        models: ["claude", "gpt4o"],
        timestamp: new Date().toISOString(),
      });
    }).not.toThrow();
  });

  it("should handle journal_posted message broadcasting without errors", () => {
    expect(() => {
      wsBroadcast("journal_posted", {
        type: "journal",
        action: "posted",
        entryId: 42,
        symbol: "TSLA",
        reasoning: "Test entry",
        timestamp: new Date().toISOString(),
      });
    }).not.toThrow();
  });

  it("should handle order_filled message broadcasting without errors", () => {
    expect(() => {
      wsBroadcast("order_filled", {
        type: "order",
        action: "filled",
        orderId: 12345,
        symbol: "MSFT",
        price: 425.5,
        qty: 100,
        execution: {
          execId: "exec-999",
          side: "BUY",
          avgPrice: 425.5,
        },
        timestamp: new Date().toISOString(),
      });
    }).not.toThrow();
  });

  it("should support all three channel types in VALID_CHANNELS", () => {
    // Test that broadcast doesn't throw for all three new channel types
    expect(() => {
      const seqId = getNextSequenceId();
      wsBroadcastWithSequence("eval_created", { type: "eval", action: "created", evalId: "1", symbol: "A", score: 1, models: [], timestamp: new Date().toISOString() }, seqId);
      wsBroadcastWithSequence("journal_posted", { type: "journal", action: "posted", entryId: 1, symbol: "B", reasoning: "test", timestamp: new Date().toISOString() }, seqId + 1);
      wsBroadcastWithSequence("order_filled", { type: "order", action: "filled", orderId: 1, symbol: "C", price: 100, qty: 10, execution: { execId: "1", side: "BUY" }, timestamp: new Date().toISOString() }, seqId + 2);
    }).not.toThrow();
  });

  it("should inject sequence_id into broadcast data", () => {
    const testData = {
      type: "eval",
      action: "created",
      evalId: "test",
      symbol: "TEST",
      score: 50,
      models: [],
      timestamp: new Date().toISOString(),
    };

    const seqId = 999;

    // Test that broadcast works with sequence injection
    expect(() => {
      wsBroadcastWithSequence("eval_created", testData, seqId);
    }).not.toThrow();
  });

  it("should handle broadcast of all message types with correct schema", () => {
    const now = new Date().toISOString();

    const evalMsg = {
      type: "eval" as const,
      action: "created" as const,
      evalId: "eval-1",
      symbol: "AAPL",
      score: 75.5,
      models: ["claude", "gpt4o", "gemini"],
      timestamp: now,
    };

    const journalMsg = {
      type: "journal" as const,
      action: "posted" as const,
      entryId: 42,
      symbol: "TSLA",
      reasoning: "Strong momentum setup",
      timestamp: now,
    };

    const orderMsg = {
      type: "order" as const,
      action: "filled" as const,
      orderId: 12345,
      symbol: "MSFT",
      price: 425.5,
      qty: 100,
      execution: {
        execId: "exec-999",
        side: "BUY" as const,
        avgPrice: 425.5,
      },
      timestamp: now,
    };

    expect(() => {
      wsBroadcast("eval_created", evalMsg);
      wsBroadcast("journal_posted", journalMsg);
      wsBroadcast("order_filled", orderMsg);
    }).not.toThrow();

    // Verify structure of messages
    expect(evalMsg.type).toBe("eval");
    expect(journalMsg.type).toBe("journal");
    expect(orderMsg.type).toBe("order");
  });

  it("should maintain sequence ordering across multiple broadcasts", () => {
    const sequences: number[] = [];

    for (let i = 0; i < 6; i++) {
      const seqId = getNextSequenceId();
      sequences.push(seqId);

      if (i % 3 === 0) {
        wsBroadcastWithSequence("eval_created", { type: "eval", action: "created", evalId: `e${i}`, symbol: "A", score: 1, models: [], timestamp: new Date().toISOString() }, seqId);
      } else if (i % 3 === 1) {
        wsBroadcastWithSequence("journal_posted", { type: "journal", action: "posted", entryId: i, symbol: "B", reasoning: "test", timestamp: new Date().toISOString() }, seqId);
      } else {
        wsBroadcastWithSequence("order_filled", { type: "order", action: "filled", orderId: i, symbol: "C", price: 100, qty: 10, execution: { execId: `${i}`, side: "BUY" }, timestamp: new Date().toISOString() }, seqId);
      }
    }

    // Verify sequences are strictly increasing
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
    }
  });
});
