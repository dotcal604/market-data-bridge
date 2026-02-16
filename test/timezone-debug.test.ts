import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

function getNowET() {
  const now = new Date();
  console.log("getNowET: now =", now.toISOString());
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hours = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minutes = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  console.log("getNowET: hours =", hours, "minutes =", minutes);
  return { hours, minutes };
}

describe("Timezone Test", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 10:00 AM ET = 15:00 UTC (during market hours)
    vi.setSystemTime(new Date("2025-01-06T15:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should get correct ET time with fake timers", () => {
    const et = getNowET();
    console.log("Test result:", et);
    expect(et.hours).toBe(10);
    expect(et.minutes).toBe(0);
  });

  it("should be during market hours (9:30-16:00 ET)", () => {
    const et = getNowET();
    const marketOpenHour = 9;
    const marketOpenMinute = 30;
    const marketCloseHour = 16;
    const marketCloseMinute = 0;

    const minutesSinceOpen =
      (et.hours - marketOpenHour) * 60 + (et.minutes - marketOpenMinute);
    const minutesBeforeClose =
      (marketCloseHour - et.hours) * 60 + (marketCloseMinute - et.minutes);

    console.log("Minutes since open:", minutesSinceOpen);
    console.log("Minutes before close:", minutesBeforeClose);

    expect(minutesSinceOpen).toBeGreaterThanOrEqual(0);
    expect(minutesBeforeClose).toBeGreaterThan(0);
  });
});
