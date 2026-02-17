import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { EnsembleWeights } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEIGHTS_PATH = join(__dirname, "..", "..", "..", "..", "data", "weights.json");
const BACKUP_PATH = WEIGHTS_PATH + ".test-backup";

describe("Regime-conditioned weights", () => {
  let originalWeights: string | null = null;

  beforeEach(() => {
    // Backup original weights.json if it exists
    if (existsSync(WEIGHTS_PATH)) {
      originalWeights = readFileSync(WEIGHTS_PATH, "utf-8");
      writeFileSync(BACKUP_PATH, originalWeights, "utf-8");
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original weights.json
    if (originalWeights !== null) {
      writeFileSync(WEIGHTS_PATH, originalWeights, "utf-8");
      if (existsSync(BACKUP_PATH)) {
        unlinkSync(BACKUP_PATH);
      }
    }
  });

  describe("getWeights with regime parameter", () => {
    it("should return default weights when no regime is provided", async () => {
      // Write test weights without overrides
      const testWeights: EnsembleWeights = {
        claude: 0.4,
        gpt4o: 0.3,
        gemini: 0.3,
        k: 1.5,
        updated_at: "2024-01-01T00:00:00.000Z",
        sample_size: 100,
        source: "test",
      };
      writeFileSync(WEIGHTS_PATH, JSON.stringify(testWeights, null, 2), "utf-8");

      // Re-import to get fresh module state
      const { getWeights, initWeights } = await import("../weights.js");
      initWeights();

      const weights = getWeights();
      expect(weights.claude).toBe(0.4);
      expect(weights.gpt4o).toBe(0.3);
      expect(weights.gemini).toBe(0.3);
      expect(weights.k).toBe(1.5);
    });

    it("should return default weights when regime is 'normal'", async () => {
      const testWeights: EnsembleWeights = {
        claude: 0.35,
        gpt4o: 0.35,
        gemini: 0.30,
        k: 1.0,
        updated_at: "2024-01-01T00:00:00.000Z",
        sample_size: 100,
        source: "test",
        regime_overrides: {
          high: { claude: 0.40, gpt4o: 0.30, gemini: 0.30, k: 1.5 },
          low: { claude: 0.30, gpt4o: 0.40, gemini: 0.30, k: 0.5 },
        },
      };
      writeFileSync(WEIGHTS_PATH, JSON.stringify(testWeights, null, 2), "utf-8");

      const { getWeights, initWeights } = await import("../weights.js");
      initWeights();

      const weights = getWeights("normal");
      expect(weights.claude).toBe(0.35);
      expect(weights.gpt4o).toBe(0.35);
      expect(weights.gemini).toBe(0.30);
      expect(weights.k).toBe(1.0);
    });

    it("should return high-vol overrides when regime is 'high'", async () => {
      const testWeights: EnsembleWeights = {
        claude: 0.35,
        gpt4o: 0.35,
        gemini: 0.30,
        k: 1.0,
        updated_at: "2024-01-01T00:00:00.000Z",
        sample_size: 100,
        source: "test",
        regime_overrides: {
          high: { claude: 0.40, gpt4o: 0.30, gemini: 0.30, k: 1.5 },
          low: { claude: 0.30, gpt4o: 0.40, gemini: 0.30, k: 0.5 },
        },
      };
      writeFileSync(WEIGHTS_PATH, JSON.stringify(testWeights, null, 2), "utf-8");

      const { getWeights, initWeights } = await import("../weights.js");
      initWeights();

      const weights = getWeights("high");
      expect(weights.claude).toBe(0.40);
      expect(weights.gpt4o).toBe(0.30);
      expect(weights.gemini).toBe(0.30);
      expect(weights.k).toBe(1.5);
    });

    it("should return low-vol overrides when regime is 'low'", async () => {
      const testWeights: EnsembleWeights = {
        claude: 0.35,
        gpt4o: 0.35,
        gemini: 0.30,
        k: 1.0,
        updated_at: "2024-01-01T00:00:00.000Z",
        sample_size: 100,
        source: "test",
        regime_overrides: {
          high: { claude: 0.40, gpt4o: 0.30, gemini: 0.30, k: 1.5 },
          low: { claude: 0.30, gpt4o: 0.40, gemini: 0.30, k: 0.5 },
        },
      };
      writeFileSync(WEIGHTS_PATH, JSON.stringify(testWeights, null, 2), "utf-8");

      const { getWeights, initWeights } = await import("../weights.js");
      initWeights();

      const weights = getWeights("low");
      expect(weights.claude).toBe(0.30);
      expect(weights.gpt4o).toBe(0.40);
      expect(weights.gemini).toBe(0.30);
      expect(weights.k).toBe(0.5);
    });

    it("should return default weights when regime overrides are not defined", async () => {
      const testWeights: EnsembleWeights = {
        claude: 0.35,
        gpt4o: 0.35,
        gemini: 0.30,
        k: 1.0,
        updated_at: "2024-01-01T00:00:00.000Z",
        sample_size: 100,
        source: "test",
      };
      writeFileSync(WEIGHTS_PATH, JSON.stringify(testWeights, null, 2), "utf-8");

      const { getWeights, initWeights } = await import("../weights.js");
      initWeights();

      const weightsHigh = getWeights("high");
      const weightsLow = getWeights("low");
      
      // Should return default weights when overrides don't exist
      expect(weightsHigh.claude).toBe(0.35);
      expect(weightsHigh.gpt4o).toBe(0.35);
      expect(weightsHigh.k).toBe(1.0);
      
      expect(weightsLow.claude).toBe(0.35);
      expect(weightsLow.gpt4o).toBe(0.35);
      expect(weightsLow.k).toBe(1.0);
    });

    it("should return default weights when specific regime override is missing", async () => {
      const testWeights: EnsembleWeights = {
        claude: 0.35,
        gpt4o: 0.35,
        gemini: 0.30,
        k: 1.0,
        updated_at: "2024-01-01T00:00:00.000Z",
        sample_size: 100,
        source: "test",
        regime_overrides: {
          high: { claude: 0.40, gpt4o: 0.30, gemini: 0.30, k: 1.5 },
          // low override intentionally missing
        },
      };
      writeFileSync(WEIGHTS_PATH, JSON.stringify(testWeights, null, 2), "utf-8");

      const { getWeights, initWeights } = await import("../weights.js");
      initWeights();

      const weightsHigh = getWeights("high");
      const weightsLow = getWeights("low");
      
      // High should use override
      expect(weightsHigh.claude).toBe(0.40);
      expect(weightsHigh.k).toBe(1.5);
      
      // Low should use default (no override)
      expect(weightsLow.claude).toBe(0.35);
      expect(weightsLow.k).toBe(1.0);
    });

    it("should preserve metadata fields when applying regime overrides", async () => {
      const testWeights: EnsembleWeights = {
        claude: 0.35,
        gpt4o: 0.35,
        gemini: 0.30,
        k: 1.0,
        updated_at: "2024-01-01T00:00:00.000Z",
        sample_size: 150,
        source: "production",
        regime_overrides: {
          high: { claude: 0.40, gpt4o: 0.30, gemini: 0.30, k: 1.5 },
        },
      };
      writeFileSync(WEIGHTS_PATH, JSON.stringify(testWeights, null, 2), "utf-8");

      const { getWeights, initWeights } = await import("../weights.js");
      initWeights();

      const weights = getWeights("high");
      
      // Should preserve metadata even with overrides
      expect(weights.updated_at).toBe("2024-01-01T00:00:00.000Z");
      expect(weights.sample_size).toBe(150);
      expect(weights.source).toBe("production");
      expect(weights.regime_overrides).toBeDefined();
    });
  });
});
