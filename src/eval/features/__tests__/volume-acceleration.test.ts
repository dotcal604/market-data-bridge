import { describe, it, expect } from "vitest";
import { computeVolumeAcceleration } from "../volume-acceleration.js";
import type { BarData } from "../../types.js";

describe("computeVolumeAcceleration", () => {
  it("should return 1 when less than 2 bars provided", () => {
    expect(computeVolumeAcceleration([])).toBe(1);
    expect(
      computeVolumeAcceleration([{ time: "09:30", open: 100, high: 105, low: 95, close: 102, volume: 1000 }]),
    ).toBe(1);
  });

  it("should calculate normal acceleration", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 105, low: 95, close: 102, volume: 1000 },
      { time: "09:35", open: 102, high: 108, low: 100, close: 106, volume: 1500 },
    ];
    // Acceleration = 1500 / 1000 = 1.5
    const result = computeVolumeAcceleration(bars);
    expect(result).toBe(1.5);
  });

  it("should calculate deceleration", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 105, low: 95, close: 102, volume: 2000 },
      { time: "09:35", open: 102, high: 108, low: 100, close: 106, volume: 1000 },
    ];
    // Acceleration = 1000 / 2000 = 0.5
    const result = computeVolumeAcceleration(bars);
    expect(result).toBe(0.5);
  });

  it("should return 1 when volumes are equal", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 105, low: 95, close: 102, volume: 1000 },
      { time: "09:35", open: 102, high: 108, low: 100, close: 106, volume: 1000 },
    ];
    // Acceleration = 1000 / 1000 = 1.0
    const result = computeVolumeAcceleration(bars);
    expect(result).toBe(1.0);
  });

  it("should return 10 when previous volume is 0 and current is positive", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 105, low: 95, close: 102, volume: 0 },
      { time: "09:35", open: 102, high: 108, low: 100, close: 106, volume: 1000 },
    ];
    // Previous volume is 0, current is positive, return 10
    const result = computeVolumeAcceleration(bars);
    expect(result).toBe(10);
  });

  it("should return 1 when both previous and current volumes are 0", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 105, low: 95, close: 102, volume: 0 },
      { time: "09:35", open: 102, high: 108, low: 100, close: 106, volume: 0 },
    ];
    // Both volumes are 0, return 1
    const result = computeVolumeAcceleration(bars);
    expect(result).toBe(1);
  });

  it("should round result to 2 decimal places", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 105, low: 95, close: 102, volume: 1000 },
      { time: "09:35", open: 102, high: 108, low: 100, close: 106, volume: 1234 },
    ];
    // Acceleration = 1234 / 1000 = 1.234, rounded to 1.23
    const result = computeVolumeAcceleration(bars);
    expect(result).toBe(1.23);
  });

  it("should use last two bars when more than 2 provided", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 105, low: 95, close: 102, volume: 500 },
      { time: "09:35", open: 102, high: 108, low: 100, close: 106, volume: 1000 },
      { time: "09:40", open: 106, high: 110, low: 104, close: 108, volume: 2000 },
    ];
    // Should use last two bars: 2000 / 1000 = 2.0
    const result = computeVolumeAcceleration(bars);
    expect(result).toBe(2.0);
  });

  it("should handle high acceleration", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 105, low: 95, close: 102, volume: 100 },
      { time: "09:35", open: 102, high: 108, low: 100, close: 106, volume: 5000 },
    ];
    // Acceleration = 5000 / 100 = 50.0
    const result = computeVolumeAcceleration(bars);
    expect(result).toBe(50.0);
  });

  it("should handle low acceleration", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 105, low: 95, close: 102, volume: 10000 },
      { time: "09:35", open: 102, high: 108, low: 100, close: 106, volume: 100 },
    ];
    // Acceleration = 100 / 10000 = 0.01
    const result = computeVolumeAcceleration(bars);
    expect(result).toBe(0.01);
  });

  it("should handle volume spike after quiet period", () => {
    const bars: BarData[] = [
      { time: "09:30", open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { time: "09:35", open: 102, high: 108, low: 100, close: 106, volume: 100000 },
    ];
    // Acceleration = 100000 / 10 = 10000
    const result = computeVolumeAcceleration(bars);
    expect(result).toBe(10000);
  });
});
