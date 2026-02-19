import { describe, expect, it } from "vitest";
import { computeStochastic } from "../stochastic.js";
import type { BarData } from "../types.js";

// Helper to create mock bars with just HLC data
function mockBar(high: number, low: number, close: number): BarData {
    return { time: "", open: 0, high, low, close, volume: 0 };
}

describe("computeStochastic", () => {
    it("returns null when bars fewer than period + smoothD - 1", () => {
        // period 14, smoothD 3 => need 14+3-1 = 16 bars
        const bars: BarData[] = Array.from({ length: 15 }, () => mockBar(105, 95, 100));
        expect(computeStochastic(bars, 14, 3)).toBeNull();
    });

    it("returns 100/100 when price is constantly at the high of the range", () => {
        // 20 bars where High=110, Low=90, Close=110
        const bars: BarData[] = Array.from({ length: 20 }, () => mockBar(110, 90, 110));

        const result = computeStochastic(bars, 14, 3);
        expect(result).not.toBeNull();
        expect(result?.k).toBe(100);
        expect(result?.d).toBe(100);
    });

    it("returns 0/0 when price is constantly at the low of the range", () => {
        // 20 bars where High=110, Low=90, Close=90
        const bars: BarData[] = Array.from({ length: 20 }, () => mockBar(110, 90, 90));

        const result = computeStochastic(bars, 14, 3);
        expect(result).not.toBeNull();
        expect(result?.k).toBe(0);
        expect(result?.d).toBe(0);
    });

    it("returns 50/50 when price is flat (High=Low)", () => {
        // 20 bars where High=100, Low=100, Close=100
        // Range is 0, handled as 50
        const bars: BarData[] = Array.from({ length: 20 }, () => mockBar(100, 100, 100));

        const result = computeStochastic(bars, 14, 3);
        expect(result).not.toBeNull();
        expect(result?.k).toBe(50);
        expect(result?.d).toBe(50);
    });

    it("calculates %K correctly for extended period", () => {
        // 20 bars ramping up: 
        // Bar 0: H=10, L=0, C=10
        // ...
        // Bar 19: H=29, L=19, C=29
        // Last 14 bars (6 to 19): Low=6, High=29 => Range=23
        // Close=29 => %K = (29-6)/23 * 100 = 100
        // PREVIOUS bar (period 5 to 18): Low=5, High=28 => Range=23
        // Close=28 => %K = (28-5)/23 * 100 = 100
        // etc.
        const bars: BarData[] = Array.from({ length: 30 }, (_, i) => mockBar(i + 10, i, i + 10));

        const result = computeStochastic(bars, 14, 3);
        expect(result).toEqual({ k: 100, d: 100 });
    });

    it("smooths %K into %D correctly", () => {
        // Create bars where %K oscillates: 100, 0, 100...
        // With period 5, smoothD 3.
        // We construct bars such that %K is predictable.
        // 
        // Simplified case:
        // Period=2, SmoothD=2
        // Bar 0: L=0, H=10, C=0  (%K=0)  - window [0,1]
        // Bar 1: L=0, H=10, C=10 (%K=100)
        // Bar 2: L=0, H=10, C=0  (%K=0)

        // Let's create a known sequence of K values implicitly by controlling H/L/C.
        // Range fixed at 0-100.
        // Bar i: High=100, Low=0. Close alternates 0, 100, 0, 100...
        const bars: BarData[] = Array.from({ length: 10 }, (_, i) =>
            mockBar(100, 0, i % 2 === 0 ? 0 : 100)
        );
        // Period=1
        // Bar 0: K=0
        // Bar 1: K=100
        // Bar 2: K=0
        // Bar 3: K=100
        // Bar ...
        // Bar 9: K=100 (odd)
        // Bar 8: K=0 (even)
        // Last K=100
        // Previous K=0
        // Previous K=100
        // SMA(3) of last 3 bars: (100+0+100)/3 = 66.67

        // Wait, let's use period=1 for simplicity to make K strictly match Close
        const result = computeStochastic(bars, 1, 3);

        // Last bar index 9 is Close=100 => K=100
        // Index 8 is Close=0 => K=0
        // Index 7 is Close=100 => K=100
        // Avg of 100, 0, 100 is 200/3 = 66.67

        expect(result?.k).toBe(100);
        expect(result?.d).toBeCloseTo(66.67, 2);
    });
});
