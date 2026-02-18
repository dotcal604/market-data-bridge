import { describe, it, expect, vi, beforeEach } from "vitest";
import { runGuardrails, type GuardrailResult } from "../behavioral.js";
import type { EnsembleScore } from "../../ensemble/types.js";

// Helper to create a mock ensemble score
function createMockEnsemble(overrides?: Partial<EnsembleScore>): EnsembleScore {
  return {
    trade_score: 70,
    trade_score_median: 70,
    expected_rr: 2.5,
    confidence: 0.8,
    should_trade: true,
    score_spread: 5,
    disagreement_penalty: 0,
    unanimous: true,
    majority_trade: true,
    weights_used: {
      claude: 0.33,
      gpt4o: 0.34,
      gemini: 0.33,
    },
    ...overrides,
  };
}

// Helper to get specific date/time for testing trading windows
function getDateAtET(hours: number, minutes: number): Date {
  // Create date in 2024-01-15 (standard time, not DST)
  const date = new Date("2024-01-15T00:00:00Z");
  // ET is UTC-5 during standard time
  const utcHours = (hours + 5) % 24;
  date.setUTCHours(utcHours, minutes, 0, 0);
  return date;
}

function getDateAtETDuringDST(hours: number, minutes: number): Date {
  // Create date in 2024-06-15 (DST period)
  const date = new Date("2024-06-15T00:00:00Z");
  // ET is UTC-4 during DST
  const utcHours = (hours + 4) % 24;
  date.setUTCHours(utcHours, minutes, 0, 0);
  return date;
}

describe("behavioral guardrails", () => {
  describe("runGuardrails", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Reset system time
      vi.useRealTimers();
    });

    it("should pass normal pattern (trading window OK, no losses)", () => {
      // Set time to 10:00 AM ET (during trading window)
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble();
      const getRecentOutcomes = () => [
        { r_multiple: 2.0 },
        { r_multiple: 1.5 },
        { r_multiple: 3.0 },
      ];

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.allowed).toBe(true);
      expect(result.trading_window_ok).toBe(true);
      expect(result.consecutive_losses).toBe(0);
      expect(result.model_disagreement_level).toBe("none");
      expect(result.flags).toHaveLength(0);

      vi.useRealTimers();
    });

    it("should flag rapid losses → revenge (3+ consecutive losses)", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble();
      const getRecentOutcomes = () => [
        { r_multiple: -1.0 }, // Most recent
        { r_multiple: -1.0 },
        { r_multiple: -1.0 },
        { r_multiple: 2.0 },  // Earlier win (breaks streak)
      ];

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.allowed).toBe(false); // Should block due to loss streak
      expect(result.trading_window_ok).toBe(true);
      expect(result.consecutive_losses).toBe(3);
      expect(result.flags).toContain("3 consecutive losses — consider pausing");

      vi.useRealTimers();
    });

    it("should flag overtrading (outside trading window)", () => {
      // Set time to 8:00 AM ET (before market open)
      const testDate = getDateAtET(8, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble();
      const getRecentOutcomes = () => [];

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.allowed).toBe(false); // Should block due to time window
      expect(result.trading_window_ok).toBe(false);
      expect(result.consecutive_losses).toBe(0);
      expect(result.flags.some((f) => f.includes("Outside trading window"))).toBe(true);
      expect(result.flags.some((f) => f.includes("8:00 ET"))).toBe(true);

      vi.useRealTimers();
    });

    it("should flag tilt detection (severe disagreement, spread > 30)", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble({
        score_spread: 35, // Severe disagreement
        unanimous: false,
      });
      const getRecentOutcomes = () => [];

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.model_disagreement_level).toBe("severe");
      expect(result.flags).toContain("Severe model disagreement (spread=35)");
      // Still allowed if in trading window and no loss streak
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });

    it("should handle first trade (no history)", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble();
      const getRecentOutcomes = () => []; // No history

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.allowed).toBe(true);
      expect(result.trading_window_ok).toBe(true);
      expect(result.consecutive_losses).toBe(0);
      expect(result.flags).toHaveLength(0);

      vi.useRealTimers();
    });

    it("should flag mild disagreement (spread 15-30)", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble({
        score_spread: 20, // Mild disagreement
        unanimous: false,
      });
      const getRecentOutcomes = () => [];

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.model_disagreement_level).toBe("mild");
      expect(result.flags).toContain("Mild model disagreement (spread=20)");
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });

    it("should flag no majority consensus", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble({
        unanimous: false,
        majority_trade: false,
      });
      const getRecentOutcomes = () => [];

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.flags).toContain("No majority consensus to trade");
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });

    it("should detect trading window during DST", () => {
      // Test during DST period (June)
      const testDate = getDateAtETDuringDST(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble();
      const getRecentOutcomes = () => [];

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.trading_window_ok).toBe(true);
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });

    it("should block outside window after market close", () => {
      // Set time to 4:30 PM ET (after market close)
      const testDate = getDateAtET(16, 30);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble();
      const getRecentOutcomes = () => [];

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.trading_window_ok).toBe(false);
      expect(result.allowed).toBe(false);
      expect(result.flags.some((f) => f.includes("Outside trading window"))).toBe(true);

      vi.useRealTimers();
    });

    it("should allow at start of trading window (9:30 AM)", () => {
      const testDate = getDateAtET(9, 30);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble();
      const getRecentOutcomes = () => [];

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.trading_window_ok).toBe(true);
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });

    it("should allow at end of trading window (3:55 PM)", () => {
      const testDate = getDateAtET(15, 55);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble();
      const getRecentOutcomes = () => [];

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.trading_window_ok).toBe(true);
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });

    it("should count consecutive losses correctly with mixed outcomes", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble();
      const getRecentOutcomes = () => [
        { r_multiple: -1.0 }, // Loss 1
        { r_multiple: -0.5 }, // Loss 2
        { r_multiple: 2.0 },  // Win (breaks streak)
        { r_multiple: -1.0 }, // Older loss (not counted)
      ];

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.consecutive_losses).toBe(2);
      expect(result.allowed).toBe(true); // Only 2 losses, threshold is 3

      vi.useRealTimers();
    });

    it("should stop counting losses when hitting a win", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble();
      const getRecentOutcomes = () => [
        { r_multiple: -1.0 }, // Loss 1
        { r_multiple: -1.0 }, // Loss 2
        { r_multiple: 2.0 },  // Win (stops count)
        { r_multiple: -1.0 }, // Older loss (not counted)
        { r_multiple: -1.0 }, // Older loss (not counted)
      ];

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.consecutive_losses).toBe(2);
      expect(result.allowed).toBe(true); // Only 2 losses, threshold is 3

      vi.useRealTimers();
    });

    it("should handle DB errors gracefully", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble();
      const getRecentOutcomes = () => {
        throw new Error("DB connection failed");
      };

      const result = runGuardrails(ensemble, getRecentOutcomes);

      // Should not crash, and should default to 0 losses
      expect(result.consecutive_losses).toBe(0);
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });

    it("should handle undefined getRecentOutcomesFn", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble();

      const result = runGuardrails(ensemble); // No getRecentOutcomesFn

      // Should not crash, and should default to 0 losses
      expect(result.consecutive_losses).toBe(0);
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });

    it("should combine multiple flags", () => {
      // Outside trading window + loss streak + disagreement
      const testDate = getDateAtET(8, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const ensemble = createMockEnsemble({
        score_spread: 25,
        unanimous: false,
        majority_trade: false,
      });
      const getRecentOutcomes = () => [
        { r_multiple: -1.0 },
        { r_multiple: -1.0 },
        { r_multiple: -1.0 },
      ];

      const result = runGuardrails(ensemble, getRecentOutcomes);

      expect(result.allowed).toBe(false);
      expect(result.flags.length).toBeGreaterThanOrEqual(3);
      expect(result.flags.some((f) => f.includes("Outside trading window"))).toBe(true);
      expect(result.flags.some((f) => f.includes("consecutive losses"))).toBe(true);
      expect(result.flags.some((f) => f.includes("disagreement"))).toBe(true);

      vi.useRealTimers();
    });

    it("should calculate disagreement level based on spread thresholds", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      // Test none (spread <= 15)
      let ensemble = createMockEnsemble({ score_spread: 10 });
      let result = runGuardrails(ensemble, () => []);
      expect(result.model_disagreement_level).toBe("none");

      // Test none (spread == 15)
      ensemble = createMockEnsemble({ score_spread: 15 });
      result = runGuardrails(ensemble, () => []);
      expect(result.model_disagreement_level).toBe("none");

      // Test mild (15 < spread <= 30)
      ensemble = createMockEnsemble({ score_spread: 16 });
      result = runGuardrails(ensemble, () => []);
      expect(result.model_disagreement_level).toBe("mild");

      // Test mild (spread == 30)
      ensemble = createMockEnsemble({ score_spread: 30 });
      result = runGuardrails(ensemble, () => []);
      expect(result.model_disagreement_level).toBe("mild");

      // Test severe (spread > 30)
      ensemble = createMockEnsemble({ score_spread: 31 });
      result = runGuardrails(ensemble, () => []);
      expect(result.model_disagreement_level).toBe("severe");

      vi.useRealTimers();
    });

    it("should add soft insufficient sample warning below soft threshold", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const result = runGuardrails(createMockEnsemble(), () => [], () => 29);

      expect(result.allowed).toBe(true);
      expect(result.insufficient_sample).toBe(false);
      expect(result.sample_size).toBe(29);
      expect(result.flags).toContain("insufficient sample: 29 trades, metrics unreliable");

      vi.useRealTimers();
    });

    it("should hard block when sample is below hard threshold", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const result = runGuardrails(createMockEnsemble(), () => [], () => 7);

      expect(result.allowed).toBe(false);
      expect(result.insufficient_sample).toBe(true);
      expect(result.sample_size).toBe(7);
      expect(result.flags).toContain("insufficient sample: 7 trades, metrics unreliable");

      vi.useRealTimers();
    });

    it("should not flag insufficient sample when sample meets soft threshold", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const result = runGuardrails(createMockEnsemble(), () => [], () => 30);

      expect(result.allowed).toBe(true);
      expect(result.insufficient_sample).toBe(false);
      expect(result.sample_size).toBe(30);
      expect(result.flags.some((f) => f.includes("insufficient sample"))).toBe(false);

      vi.useRealTimers();
    });

    it("should keep sample defaults when outcome count callback is omitted", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const result = runGuardrails(createMockEnsemble(), () => []);

      expect(result.allowed).toBe(true);
      expect(result.insufficient_sample).toBe(false);
      expect(result.sample_size).toBe(0);

      vi.useRealTimers();
    });

    it("should handle outcome count callback errors gracefully", () => {
      const testDate = getDateAtET(10, 0);
      vi.useFakeTimers();
      vi.setSystemTime(testDate);

      const result = runGuardrails(createMockEnsemble(), () => [], () => {
        throw new Error("count failure");
      });

      expect(result.allowed).toBe(true);
      expect(result.insufficient_sample).toBe(false);
      expect(result.sample_size).toBe(0);

      vi.useRealTimers();
    });

  });
});
