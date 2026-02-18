import { beforeEach, describe, expect, it, vi } from "vitest";

const existsSyncMock = vi.fn();
const readFileSyncMock = vi.fn();
const writeFileSyncMock = vi.fn();

const getEvaluationByIdMock = vi.fn();
const getModelOutputsForEvalMock = vi.fn();

const updatePriorsMock = vi.fn();
const getBayesianWeightsMock = vi.fn();
const toJSONMock = vi.fn();
const fromJSONMock = vi.fn();

const getWeightsMock = vi.fn();
const updateWeightsMock = vi.fn();

const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();
const loggerDebugMock = vi.fn();

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock,
    default: {
      ...actual,
      existsSync: existsSyncMock,
      readFileSync: readFileSyncMock,
      writeFileSync: writeFileSyncMock,
    },
  };
});

vi.mock("../../../db/database.js", () => ({
  getEvaluationById: getEvaluationByIdMock,
  getModelOutputsForEval: getModelOutputsForEvalMock,
}));

vi.mock("../bayesian-updater.js", () => ({
  bayesianUpdater: {
    updatePriors: updatePriorsMock,
    getWeights: getBayesianWeightsMock,
    toJSON: toJSONMock,
    fromJSON: fromJSONMock,
  },
}));

vi.mock("../weights.js", () => ({
  getWeights: getWeightsMock,
  updateWeights: updateWeightsMock,
}));

vi.mock("../../../logging.js", () => ({
  logger: {
    child: () => ({
      info: loggerInfoMock,
      warn: loggerWarnMock,
      error: loggerErrorMock,
      debug: loggerDebugMock,
    }),
  },
}));

describe("recalibration-hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    existsSyncMock.mockReturnValue(false);
    toJSONMock.mockReturnValue("[[\"TRENDING\",{\"claude\":1,\"gemini\":1,\"openai\":1}]]");
    getWeightsMock.mockReturnValue({ claude: 0.333, gpt4o: 0.333, gemini: 0.334, sample_size: 0 });
    getBayesianWeightsMock.mockImplementation((regime: string) => {
      if (regime === "TRENDING") return { claude: 0.5, gemini: 0.2, openai: 0.3 };
      return { claude: 1 / 3, gemini: 1 / 3, openai: 1 / 3 };
    });
  });

  it("no-ops when trade was not taken", async () => {
    const { onOutcomeRecorded } = await import("../recalibration-hook.js");

    onOutcomeRecorded("eval-1", 1.2, false);

    expect(getEvaluationByIdMock).not.toHaveBeenCalled();
    expect(updatePriorsMock).not.toHaveBeenCalled();
  });

  it("no-ops when rMultiple is null", async () => {
    const { onOutcomeRecorded } = await import("../recalibration-hook.js");

    onOutcomeRecorded("eval-1", null, true);

    expect(getEvaluationByIdMock).not.toHaveBeenCalled();
  });

  it("updates Bayesian priors using mapped model predictions", async () => {
    getEvaluationByIdMock.mockReturnValue({ direction: "long", volatility_regime: "high" });
    getModelOutputsForEvalMock.mockReturnValue([
      { model_id: "claude-sonnet", trade_score: 60, should_trade: 1 },
      { model_id: "gpt-4o", trade_score: 20, should_trade: 0 },
      { model_id: "gemini-flash", trade_score: 55, should_trade: 1 },
    ]);

    const { onOutcomeRecorded } = await import("../recalibration-hook.js");
    onOutcomeRecorded("eval-123", 1.1, true);

    expect(updatePriorsMock).toHaveBeenCalledWith(
      "VOLATILE",
      1.1,
      { claude: 1, openai: -1, gemini: 1 },
      1,
    );
    expect(writeFileSyncMock).toHaveBeenCalledOnce();
  });

  it("triggers batch recalibration after 50 outcomes", async () => {
    getEvaluationByIdMock.mockReturnValue({ direction: "long", volatility_regime: "normal" });
    getModelOutputsForEvalMock.mockReturnValue([
      { model_id: "claude", trade_score: 60, should_trade: 1 },
    ]);

    const { onOutcomeRecorded } = await import("../recalibration-hook.js");

    for (let i = 0; i < 50; i += 1) {
      onOutcomeRecorded(`eval-${i}`, 1, true);
    }

    expect(updateWeightsMock).toHaveBeenCalledOnce();
    expect(updateWeightsMock).toHaveBeenCalledWith(
      expect.objectContaining({ sample_size: 50 }),
      "bayesian_recalibration",
    );
  });

  it("does not update ensemble weights when recalibration delta is below threshold", async () => {
    getEvaluationByIdMock.mockReturnValue({ direction: "long", volatility_regime: "normal" });
    getModelOutputsForEvalMock.mockReturnValue([
      { model_id: "claude", trade_score: 60, should_trade: 1 },
    ]);
    getBayesianWeightsMock.mockReturnValue({ claude: 0.3335, gemini: 0.333, openai: 0.3335 });

    const { onOutcomeRecorded } = await import("../recalibration-hook.js");

    for (let i = 0; i < 50; i += 1) {
      onOutcomeRecorded(`eval-${i}`, 1, true);
    }

    expect(updateWeightsMock).not.toHaveBeenCalled();
    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ totalDelta: expect.any(String) }),
      "Batch recalibration: weights unchanged (below threshold)",
    );
  });

  it("loads saved Bayesian state during initialization", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("[[\"TRENDING\",{\"claude\":2,\"gemini\":1,\"openai\":1}]]");

    const { initRecalibration } = await import("../recalibration-hook.js");
    initRecalibration();

    expect(fromJSONMock).toHaveBeenCalledOnce();
    expect(loggerInfoMock).toHaveBeenCalledWith("Recalibration hook initialized");
  });

  it("reports recalibration status diagnostics", async () => {
    existsSyncMock.mockReturnValue(true);

    const { getRecalibrationStatus } = await import("../recalibration-hook.js");
    const status = getRecalibrationStatus();

    expect(status).toEqual(
      expect.objectContaining({
        outcomes_since_last_recal: 0,
        batch_interval: 50,
        state_file_exists: true,
      }),
    );
    expect(getBayesianWeightsMock).toHaveBeenCalledWith("TRENDING");
    expect(getBayesianWeightsMock).toHaveBeenCalledWith("CHOP");
    expect(getBayesianWeightsMock).toHaveBeenCalledWith("VOLATILE");
  });
});
