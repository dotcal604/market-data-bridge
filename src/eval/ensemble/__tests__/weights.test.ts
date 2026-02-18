import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileSyncMock = vi.fn();
const writeFileSyncMock = vi.fn();
const watchFileMock = vi.fn();
const existsSyncMock = vi.fn();
const insertWeightHistoryMock = vi.fn();

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock,
    watchFile: watchFileMock,
    existsSync: existsSyncMock,
    default: {
      ...actual,
      readFileSync: readFileSyncMock,
      writeFileSync: writeFileSyncMock,
      watchFile: watchFileMock,
      existsSync: existsSyncMock,
    },
  };
});

vi.mock("../../../db/database.js", () => ({
  insertWeightHistory: insertWeightHistoryMock,
}));

vi.mock("../../../logging.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("ensemble weights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns default weights when no file exists", async () => {
    existsSyncMock.mockReturnValue(false);

    const { initWeights, getWeights } = await import("../weights.js");
    initWeights();

    const weights = getWeights();
    expect(weights.claude).toBe(0.333);
    expect(weights.gpt4o).toBe(0.333);
    expect(weights.gemini).toBe(0.334);
    expect(weights.source).toBe("default");
  });

  it("loads weights from weights.json when present", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        claude: 0.5,
        gpt4o: 0.3,
        gemini: 0.2,
        k: 2,
        updated_at: "2024-01-01T00:00:00.000Z",
        sample_size: 42,
        source: "file",
      }),
    );

    const { initWeights, getWeights } = await import("../weights.js");
    initWeights();

    const weights = getWeights();
    expect(weights).toMatchObject({
      claude: 0.5,
      gpt4o: 0.3,
      gemini: 0.2,
      k: 2,
      sample_size: 42,
    });
  });

  it("persists and records updates", async () => {
    existsSyncMock.mockReturnValue(false);

    const { updateWeights } = await import("../weights.js");
    const updated = updateWeights(
      { claude: 0.4, gpt4o: 0.3, gemini: 0.3, k: 1.7, sample_size: 100 },
      "manual_test",
    );

    expect(writeFileSyncMock).toHaveBeenCalledOnce();
    expect(insertWeightHistoryMock).toHaveBeenCalledWith(expect.objectContaining({
      claude: 0.4,
      gpt4o: 0.3,
      gemini: 0.3,
    }), "manual_test");
    expect(updated.source).toBe("manual_test");
  });

  it("throws when weights do not sum to 1.0", async () => {
    const { updateWeights } = await import("../weights.js");

    expect(() => {
      updateWeights({ claude: 0.8, gpt4o: 0.3, gemini: 0.3 }, "bad");
    }).toThrow(/Weights must sum to 1.0/);
  });

  it("applies high-regime overrides", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        claude: 0.34,
        gpt4o: 0.33,
        gemini: 0.33,
        k: 1.1,
        regime_overrides: {
          high: { claude: 0.5, gpt4o: 0.2, gemini: 0.3, k: 2.2 },
        },
      }),
    );

    const { initWeights, getWeights } = await import("../weights.js");
    initWeights();

    const weights = getWeights("high");
    expect(weights.claude).toBe(0.5);
    expect(weights.gpt4o).toBe(0.2);
    expect(weights.gemini).toBe(0.3);
    expect(weights.k).toBe(2.2);
  });

  it("hot-reloads weights when watch callback fires", async () => {
    existsSyncMock.mockReturnValue(true);
    let payload = JSON.stringify({ claude: 0.4, gpt4o: 0.3, gemini: 0.3, k: 1.5 });
    readFileSyncMock.mockImplementation(() => payload);

    const { initWeights, getWeights } = await import("../weights.js");
    initWeights();
    expect(getWeights().claude).toBe(0.4);

    payload = JSON.stringify({ claude: 0.2, gpt4o: 0.4, gemini: 0.4, k: 1.8 });
    const callback = watchFileMock.mock.calls[0]?.[2] as (() => void) | undefined;
    expect(callback).toBeTypeOf("function");
    callback?.();

    const reloaded = getWeights();
    expect(reloaded.claude).toBe(0.2);
    expect(reloaded.gpt4o).toBe(0.4);
    expect(reloaded.gemini).toBe(0.4);
    expect(reloaded.k).toBe(1.8);
  });
});
