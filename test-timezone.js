// Debug timezone issue
import { vi } from "vitest";

// Test the exact time from the test
const testTime = new Date("2025-01-06T15:00:00Z");
console.log("Test time (UTC):", testTime.toISOString());
console.log("Test time (local):", testTime.toString());

// Check what getNowET would return
const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "numeric",
  hour12: false,
}).formatToParts(testTime);

const hours = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
const minutes = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);

console.log("ET hours:", hours);
console.log("ET minutes:", minutes);
console.log("Expected: 10:00 (10 hours, 0 minutes)");

// Check market hours logic
const marketOpenHour = 9;
const marketOpenMinute = 30;
const marketCloseHour = 16;
const marketCloseMinute = 0;

const minutesSinceOpen =
  (hours - marketOpenHour) * 60 + (minutes - marketOpenMinute);
const minutesBeforeClose =
  (marketCloseHour - hours) * 60 + (marketCloseMinute - minutes);

console.log("\nMarket hours check:");
console.log("Minutes since open:", minutesSinceOpen);
console.log("Minutes before close:", minutesBeforeClose);
console.log("Is during market hours?", minutesSinceOpen >= 0 && minutesBeforeClose > 0);
