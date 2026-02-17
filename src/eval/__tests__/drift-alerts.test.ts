import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkDriftAlerts } from "../drift-alerts.js";
import type { DriftReport } from "../drift.js";
import * as configModule from "../../config.js";

describe("checkDriftAlerts", () => {
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
  });

  it("should generate accuracy_low alert when overall accuracy is below threshold", () => {
    const report: DriftReport = {
      overall_accuracy: 0.50,
      by_model: [],
      regime_shift_detected: false,
      recommendation: "Monitor",
    };

    const alerts = checkDriftAlerts(report);

    expect(alerts.length).toBeGreaterThan(0);
    const accuracyAlert = alerts.find((a) => a.alert_type === "accuracy_low" && a.model_id === null);
    expect(accuracyAlert).toBeDefined();
    expect(accuracyAlert?.metric_value).toBe(0.50);
    expect(accuracyAlert?.threshold).toBe(0.55);
    expect(accuracyAlert?.message).toContain("50.0%");
    expect(accuracyAlert?.message).toContain("55.0%");
  });

  it("should not generate alert when overall accuracy is above threshold", () => {
    const report: DriftReport = {
      overall_accuracy: 0.65,
      by_model: [],
      regime_shift_detected: false,
      recommendation: "Monitor",
    };

    const alerts = checkDriftAlerts(report);

    const accuracyAlert = alerts.find((a) => a.alert_type === "accuracy_low" && a.model_id === null);
    expect(accuracyAlert).toBeUndefined();
  });

  it("should generate accuracy_low alert for per-model accuracy below threshold", () => {
    const report: DriftReport = {
      overall_accuracy: 0.60,
      by_model: [
        {
          model_id: "claude-sonnet",
          sample_size: 50,
          rolling_accuracy: {
            last_50: 0.60,
            last_20: 0.50,
            last_10: 0.45,
          },
          calibration_error: 0.10,
          calibration_by_decile: [],
          regime_shift_detected: false,
        },
      ],
      regime_shift_detected: false,
      recommendation: "Monitor",
    };

    const alerts = checkDriftAlerts(report);

    const modelAlert = alerts.find((a) => a.alert_type === "accuracy_low" && a.model_id === "claude-sonnet");
    expect(modelAlert).toBeDefined();
    expect(modelAlert?.metric_value).toBe(0.50);
    expect(modelAlert?.threshold).toBe(0.55);
    expect(modelAlert?.message).toContain("claude-sonnet");
    expect(modelAlert?.message).toContain("50.0%");
  });

  it("should generate calibration_high alert when calibration error is above threshold", () => {
    const report: DriftReport = {
      overall_accuracy: 0.60,
      by_model: [
        {
          model_id: "gpt-4o",
          sample_size: 50,
          rolling_accuracy: {
            last_50: 0.60,
            last_20: 0.60,
            last_10: 0.60,
          },
          calibration_error: 0.20,
          calibration_by_decile: [],
          regime_shift_detected: false,
        },
      ],
      regime_shift_detected: false,
      recommendation: "Monitor",
    };

    const alerts = checkDriftAlerts(report);

    const calibrationAlert = alerts.find((a) => a.alert_type === "calibration_high" && a.model_id === "gpt-4o");
    expect(calibrationAlert).toBeDefined();
    expect(calibrationAlert?.metric_value).toBe(0.20);
    expect(calibrationAlert?.threshold).toBe(0.15);
    expect(calibrationAlert?.message).toContain("gpt-4o");
    expect(calibrationAlert?.message).toContain("20.0%");
  });

  it("should generate regime_shift alert when regime shift is detected", () => {
    const report: DriftReport = {
      overall_accuracy: 0.60,
      by_model: [
        {
          model_id: "gemini-flash",
          sample_size: 50,
          rolling_accuracy: {
            last_50: 0.70,
            last_20: 0.60,
            last_10: 0.50,
          },
          calibration_error: 0.10,
          calibration_by_decile: [],
          regime_shift_detected: true,
        },
      ],
      regime_shift_detected: true,
      recommendation: "Reduce risk",
    };

    const alerts = checkDriftAlerts(report);

    const regimeAlert = alerts.find((a) => a.alert_type === "regime_shift" && a.model_id === "gemini-flash");
    expect(regimeAlert).toBeDefined();
    expect(regimeAlert?.metric_value).toBeCloseTo(0.20, 2);
    expect(regimeAlert?.threshold).toBe(0.15);
    expect(regimeAlert?.message).toContain("gemini-flash");
    expect(regimeAlert?.message).toContain("regime shift");
  });

  it("should generate multiple alerts for multiple models and issues", () => {
    const report: DriftReport = {
      overall_accuracy: 0.50,
      by_model: [
        {
          model_id: "claude-sonnet",
          sample_size: 50,
          rolling_accuracy: {
            last_50: 0.60,
            last_20: 0.50,
            last_10: 0.45,
          },
          calibration_error: 0.20,
          calibration_by_decile: [],
          regime_shift_detected: false,
        },
        {
          model_id: "gpt-4o",
          sample_size: 50,
          rolling_accuracy: {
            last_50: 0.70,
            last_20: 0.60,
            last_10: 0.50,
          },
          calibration_error: 0.10,
          calibration_by_decile: [],
          regime_shift_detected: true,
        },
      ],
      regime_shift_detected: true,
      recommendation: "Reduce risk",
    };

    const alerts = checkDriftAlerts(report);

    // Should have: 1 overall accuracy + 2 model accuracy + 1 calibration + 1 regime shift = 5 alerts
    expect(alerts.length).toBeGreaterThanOrEqual(4);
    
    // Check for each type
    expect(alerts.find((a) => a.alert_type === "accuracy_low" && a.model_id === null)).toBeDefined();
    expect(alerts.find((a) => a.alert_type === "accuracy_low" && a.model_id === "claude-sonnet")).toBeDefined();
    expect(alerts.find((a) => a.alert_type === "calibration_high" && a.model_id === "claude-sonnet")).toBeDefined();
    expect(alerts.find((a) => a.alert_type === "regime_shift" && a.model_id === "gpt-4o")).toBeDefined();
  });

  it("should include timestamp in alerts", () => {
    const report: DriftReport = {
      overall_accuracy: 0.50,
      by_model: [],
      regime_shift_detected: false,
      recommendation: "Monitor",
    };

    const alerts = checkDriftAlerts(report);

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].timestamp).toBeDefined();
    expect(typeof alerts[0].timestamp).toBe("string");
    expect(new Date(alerts[0].timestamp).toISOString()).toBe(alerts[0].timestamp);
  });

  it("should not trigger alert when accuracy exactly equals threshold", () => {
    const report: DriftReport = {
      overall_accuracy: 0.55,
      by_model: [],
      regime_shift_detected: false,
      recommendation: "Monitor",
    };

    const alerts = checkDriftAlerts(report);

    const accuracyAlert = alerts.find((a) => a.alert_type === "accuracy_low" && a.model_id === null);
    expect(accuracyAlert).toBeUndefined();
  });

  it("should not trigger calibration alert when error exactly equals threshold", () => {
    const report: DriftReport = {
      overall_accuracy: 0.60,
      by_model: [
        {
          model_id: "claude-sonnet",
          sample_size: 50,
          rolling_accuracy: {
            last_50: 0.60,
            last_20: 0.60,
            last_10: 0.60,
          },
          calibration_error: 0.15,
          calibration_by_decile: [],
          regime_shift_detected: false,
        },
      ],
      regime_shift_detected: false,
      recommendation: "Monitor",
    };

    const alerts = checkDriftAlerts(report);

    const calibrationAlert = alerts.find((a) => a.alert_type === "calibration_high");
    expect(calibrationAlert).toBeUndefined();
  });
});
