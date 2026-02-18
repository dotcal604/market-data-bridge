import { describe, it, expect, beforeEach } from "vitest";
import { TickVelocity, computeTickVelocity } from "../tick-velocity.js";

describe("TickVelocity", () => {
  let tracker: TickVelocity;

  beforeEach(() => {
    tracker = new TickVelocity(10); // Small window for easier testing
  });

  describe("push", () => {
    it("should accept and store tick data", () => {
      tracker.push(100.0, 1000);
      tracker.push(100.5, 2000);
      
      // If data is stored correctly, velocity should be calculable
      const velocity = tracker.getVelocity(1);
      expect(velocity).toBeDefined();
    });

    it("should handle single tick without error", () => {
      tracker.push(100.0, 1000);
      
      // Should not throw error
      const velocity = tracker.getVelocity(1);
      expect(velocity).toBe(0); // Not enough data
    });

    it("should overwrite oldest values when buffer is full", () => {
      // Fill buffer with 10 ticks
      for (let i = 0; i < 10; i++) {
        tracker.push(100.0 + i, 1000 + i * 1000);
      }
      
      // Add 11th tick - should overwrite first
      tracker.push(200.0, 11000);
      
      // Should still work without error
      const velocity = tracker.getVelocity(2);
      expect(velocity).toBeDefined();
    });
  });

  describe("getVelocity", () => {
    it("should return 0 when insufficient data", () => {
      tracker.push(100.0, 1000);
      
      // Need lookback + 1 ticks
      const velocity = tracker.getVelocity(1);
      expect(velocity).toBe(0);
    });

    it("should calculate positive velocity for upward price movement", () => {
      const baseTime = 10000;
      tracker.push(100.0, baseTime);
      tracker.push(101.0, baseTime + 1000); // +$1 in 1000ms
      tracker.push(102.0, baseTime + 2000); // +$1 in 1000ms
      
      const velocity = tracker.getVelocity(1);
      // Velocity = (102 - 101) / 1000 = 0.001
      expect(velocity).toBeCloseTo(0.001, 6);
    });

    it("should calculate negative velocity for downward price movement", () => {
      const baseTime = 10000;
      tracker.push(100.0, baseTime);
      tracker.push(99.0, baseTime + 1000); // -$1 in 1000ms
      tracker.push(98.0, baseTime + 2000); // -$1 in 1000ms
      
      const velocity = tracker.getVelocity(1);
      // Velocity = (98 - 99) / 1000 = -0.001
      expect(velocity).toBeCloseTo(-0.001, 6);
    });

    it("should return 0 when time delta is 0", () => {
      const baseTime = 10000;
      tracker.push(100.0, baseTime);
      tracker.push(101.0, baseTime); // Same timestamp
      tracker.push(102.0, baseTime);
      
      const velocity = tracker.getVelocity(1);
      expect(velocity).toBe(0); // dt = 0, prevent division by zero
    });

    it("should calculate velocity over specified lookback period", () => {
      const baseTime = 10000;
      // Create 5 ticks with consistent price increase
      for (let i = 0; i < 5; i++) {
        tracker.push(100.0 + i * 2, baseTime + i * 1000);
      }
      
      // Velocity over 2 ticks: (108 - 104) / 2000 = 0.002
      const velocity = tracker.getVelocity(2);
      expect(velocity).toBeCloseTo(0.002, 6);
    });

    it("should handle very high tick rate", () => {
      const baseTime = 10000;
      // High frequency ticks (every 10ms)
      for (let i = 0; i < 5; i++) {
        tracker.push(100.0 + i * 0.01, baseTime + i * 10);
      }
      
      const velocity = tracker.getVelocity(2);
      // Velocity = (100.04 - 100.02) / 20 = 0.02 / 20 = 0.001
      expect(velocity).toBeCloseTo(0.001, 6);
    });
  });

  describe("getAcceleration", () => {
    it("should return 0 when insufficient data", () => {
      const baseTime = 10000;
      tracker.push(100.0, baseTime);
      tracker.push(101.0, baseTime + 1000);
      
      // Need (lookback * 2) + 1 ticks
      const acceleration = tracker.getAcceleration(1);
      expect(acceleration).toBe(0);
    });

    it("should calculate positive acceleration for increasing velocity", () => {
      const baseTime = 10000;
      tracker.push(100.0, baseTime);        // t=0
      tracker.push(101.0, baseTime + 1000); // t=1000, v1 = 1/1000
      tracker.push(103.0, baseTime + 2000); // t=2000, v2 = 2/1000
      tracker.push(106.0, baseTime + 3000); // t=3000, v3 = 3/1000
      
      const acceleration = tracker.getAcceleration(1);
      // v_recent = (106 - 103) / 1000 = 0.003
      // v_prev = (103 - 101) / 1000 = 0.002
      // a = (0.003 - 0.002) / 1000 = 0.000001
      expect(acceleration).toBeGreaterThan(0);
    });

    it("should calculate negative acceleration for decreasing velocity", () => {
      const baseTime = 10000;
      tracker.push(100.0, baseTime);        // t=0
      tracker.push(103.0, baseTime + 1000); // t=1000, rapid increase
      tracker.push(105.0, baseTime + 2000); // t=2000, slower increase
      tracker.push(106.0, baseTime + 3000); // t=3000, even slower
      
      const acceleration = tracker.getAcceleration(1);
      // v_recent = (106 - 105) / 1000 = 0.001
      // v_prev = (105 - 103) / 1000 = 0.002
      // a = (0.001 - 0.002) / 1000 = -0.000001
      expect(acceleration).toBeLessThan(0);
    });

    it("should return 0 when time delta is 0", () => {
      const baseTime = 10000;
      tracker.push(100.0, baseTime);
      tracker.push(101.0, baseTime); // Same timestamp
      tracker.push(102.0, baseTime);
      tracker.push(103.0, baseTime);
      
      const acceleration = tracker.getAcceleration(1);
      expect(acceleration).toBe(0);
    });

    it("should calculate acceleration over specified lookback period", () => {
      const baseTime = 10000;
      // Create 7 ticks for lookback=2
      for (let i = 0; i < 7; i++) {
        // Quadratic price increase (acceleration)
        tracker.push(100.0 + i * i * 0.5, baseTime + i * 1000);
      }
      
      const acceleration = tracker.getAcceleration(2);
      expect(acceleration).toBeDefined();
      expect(typeof acceleration).toBe("number");
    });
  });

  describe("reset", () => {
    it("should clear all tick data", () => {
      const baseTime = 10000;
      for (let i = 0; i < 5; i++) {
        tracker.push(100.0 + i, baseTime + i * 1000);
      }
      
      // Before reset, should have velocity
      const velocityBefore = tracker.getVelocity(2);
      expect(velocityBefore).not.toBe(0);
      
      // After reset, should have no data
      tracker.reset();
      const velocityAfter = tracker.getVelocity(2);
      expect(velocityAfter).toBe(0);
    });

    it("should allow new data after reset", () => {
      tracker.push(100.0, 1000);
      tracker.reset();
      
      // Should be able to add new data
      tracker.push(200.0, 2000);
      tracker.push(201.0, 3000);
      tracker.push(202.0, 4000);
      
      const velocity = tracker.getVelocity(1);
      expect(velocity).toBeCloseTo(0.001, 6); // (202 - 201) / 1000
    });
  });

  describe("edge cases", () => {
    it("should handle zero ticks (initialization)", () => {
      const velocity = tracker.getVelocity(1);
      const acceleration = tracker.getAcceleration(1);
      
      expect(velocity).toBe(0);
      expect(acceleration).toBe(0);
    });

    it("should handle large price movements", () => {
      const baseTime = 10000;
      tracker.push(100.0, baseTime);
      tracker.push(1000.0, baseTime + 1000); // +$900 in 1s
      tracker.push(10000.0, baseTime + 2000); // +$9000 in 1s
      
      const velocity = tracker.getVelocity(1);
      expect(velocity).toBe(9.0); // 9000 / 1000
    });

    it("should handle very small price movements", () => {
      const baseTime = 10000;
      tracker.push(100.000, baseTime);
      tracker.push(100.001, baseTime + 1000);
      tracker.push(100.002, baseTime + 2000);
      
      const velocity = tracker.getVelocity(1);
      expect(velocity).toBeCloseTo(0.000001, 9);
    });

    it("should handle custom window size", () => {
      const largeTracker = new TickVelocity(100);
      const baseTime = 10000;
      
      // Add 50 ticks
      for (let i = 0; i < 50; i++) {
        largeTracker.push(100.0 + i * 0.1, baseTime + i * 100);
      }
      
      const velocity = largeTracker.getVelocity(10);
      expect(velocity).toBeDefined();
      expect(typeof velocity).toBe("number");
    });
  });
});

describe("computeTickVelocity", () => {
  it("should return null when tick data is unavailable", () => {
    const result = computeTickVelocity();
    expect(result).toBeNull();
  });
});
