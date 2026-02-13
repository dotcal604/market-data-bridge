import { describe, it, expect } from "vitest";
import { classifyTimeOfDay, minutesSinceOpen } from "../time-classification.js";

describe("classifyTimeOfDay", () => {
  it("should classify as 'premarket' before 9:30 AM ET", () => {
    // 9:00 AM ET (13:00 UTC during EST, 14:00 UTC during DST)
    const dateEST = new Date("2024-01-15T14:00:00Z"); // Winter (EST)
    expect(classifyTimeOfDay(dateEST)).toBe("premarket");

    const dateDST = new Date("2024-06-15T13:00:00Z"); // Summer (EDT)
    expect(classifyTimeOfDay(dateDST)).toBe("premarket");
  });

  it("should classify as 'open_drive' between 9:30 and 10:00 AM ET", () => {
    // 9:45 AM ET
    const dateEST = new Date("2024-01-15T14:45:00Z"); // Winter
    expect(classifyTimeOfDay(dateEST)).toBe("open_drive");

    const dateDST = new Date("2024-06-15T13:45:00Z"); // Summer
    expect(classifyTimeOfDay(dateDST)).toBe("open_drive");
  });

  it("should classify as 'morning' between 10:00 AM and 12:00 PM ET", () => {
    // 11:00 AM ET
    const dateEST = new Date("2024-01-15T16:00:00Z"); // Winter
    expect(classifyTimeOfDay(dateEST)).toBe("morning");

    const dateDST = new Date("2024-06-15T15:00:00Z"); // Summer
    expect(classifyTimeOfDay(dateDST)).toBe("morning");
  });

  it("should classify as 'midday' between 12:00 and 2:30 PM ET", () => {
    // 1:00 PM ET
    const dateEST = new Date("2024-01-15T18:00:00Z"); // Winter
    expect(classifyTimeOfDay(dateEST)).toBe("midday");

    const dateDST = new Date("2024-06-15T17:00:00Z"); // Summer
    expect(classifyTimeOfDay(dateDST)).toBe("midday");
  });

  it("should classify as 'power_hour' between 2:30 and 3:55 PM ET", () => {
    // 3:00 PM ET
    const dateEST = new Date("2024-01-15T20:00:00Z"); // Winter
    expect(classifyTimeOfDay(dateEST)).toBe("power_hour");

    const dateDST = new Date("2024-06-15T19:00:00Z"); // Summer
    expect(classifyTimeOfDay(dateDST)).toBe("power_hour");
  });

  it("should classify as 'close' at 3:55 PM ET and after", () => {
    // 3:55 PM ET
    const dateEST = new Date("2024-01-15T20:55:00Z"); // Winter
    expect(classifyTimeOfDay(dateEST)).toBe("close");

    const dateDST = new Date("2024-06-15T19:55:00Z"); // Summer
    expect(classifyTimeOfDay(dateDST)).toBe("close");

    // 4:00 PM ET (after hours)
    const dateEST2 = new Date("2024-01-15T21:00:00Z");
    expect(classifyTimeOfDay(dateEST2)).toBe("close");
  });

  it("should handle exact boundary at 9:30 AM ET (open_drive starts)", () => {
    // 9:30 AM ET exactly
    const dateEST = new Date("2024-01-15T14:30:00Z"); // Winter
    expect(classifyTimeOfDay(dateEST)).toBe("open_drive");
  });

  it("should handle exact boundary at 10:00 AM ET (morning starts)", () => {
    // 10:00 AM ET exactly
    const dateEST = new Date("2024-01-15T15:00:00Z"); // Winter
    expect(classifyTimeOfDay(dateEST)).toBe("morning");
  });

  it("should handle DST transition correctly", () => {
    // Day before DST starts (March 9, 2024 - last day of EST)
    const beforeDST = new Date("2024-03-09T15:00:00Z"); // 10:00 AM EST
    expect(classifyTimeOfDay(beforeDST)).toBe("morning");

    // Day after DST starts (March 11, 2024 - first full day of EDT)
    const afterDST = new Date("2024-03-11T14:00:00Z"); // 10:00 AM EDT
    expect(classifyTimeOfDay(afterDST)).toBe("morning");
  });

  it("should handle early morning hours", () => {
    // 6:00 AM ET (pre-premarket)
    const dateEST = new Date("2024-01-15T11:00:00Z"); // Winter
    expect(classifyTimeOfDay(dateEST)).toBe("premarket");
  });

  it("should handle late evening hours", () => {
    // 8:00 PM ET (after close)
    const dateEST = new Date("2024-01-16T01:00:00Z"); // Winter
    expect(classifyTimeOfDay(dateEST)).toBe("close");
  });
});

describe("minutesSinceOpen", () => {
  it("should return 0 at 9:30 AM ET (market open)", () => {
    const dateEST = new Date("2024-01-15T14:30:00Z"); // Winter
    expect(minutesSinceOpen(dateEST)).toBe(0);

    const dateDST = new Date("2024-06-15T13:30:00Z"); // Summer
    expect(minutesSinceOpen(dateDST)).toBe(0);
  });

  it("should return 30 at 10:00 AM ET", () => {
    const dateEST = new Date("2024-01-15T15:00:00Z"); // Winter
    expect(minutesSinceOpen(dateEST)).toBe(30);
  });

  it("should return 210 at 1:00 PM ET (midday)", () => {
    const dateEST = new Date("2024-01-15T18:00:00Z"); // Winter
    expect(minutesSinceOpen(dateEST)).toBe(210);
  });

  it("should return 390 at 4:00 PM ET (market close)", () => {
    const dateEST = new Date("2024-01-15T21:00:00Z"); // Winter
    expect(minutesSinceOpen(dateEST)).toBe(390);
  });

  it("should return negative value before 9:30 AM", () => {
    // 9:00 AM ET
    const dateEST = new Date("2024-01-15T14:00:00Z"); // Winter
    expect(minutesSinceOpen(dateEST)).toBe(-30);
  });

  it("should handle DST correctly", () => {
    // 10:00 AM EDT (summer)
    const dateDST = new Date("2024-06-15T14:00:00Z");
    expect(minutesSinceOpen(dateDST)).toBe(30);

    // 10:00 AM EST (winter)
    const dateEST = new Date("2024-01-15T15:00:00Z");
    expect(minutesSinceOpen(dateEST)).toBe(30);
  });

  it("should calculate minutes correctly at 3:55 PM ET (close time)", () => {
    const dateEST = new Date("2024-01-15T20:55:00Z"); // Winter
    expect(minutesSinceOpen(dateEST)).toBe(385);
  });

  it("should handle end of trading day", () => {
    // 3:59 PM ET
    const dateEST = new Date("2024-01-15T20:59:00Z"); // Winter
    expect(minutesSinceOpen(dateEST)).toBe(389);
  });
});
