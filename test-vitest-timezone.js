// Test with vitest fake timers
import { vi } from "vitest";

console.log("=== Before fake timers ===");
const realTime = new Date("2025-01-06T15:00:00Z");
console.log("Real time UTC:", realTime.toISOString());

const realParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "numeric",
  hour12: false,
}).formatToParts(realTime);

console.log("Real ET:", realParts.find((p) => p.type === "hour")?.value, ":", realParts.find((p) => p.type === "minute")?.value);

console.log("\n=== After setting fake timers ===");
vi.useFakeTimers();
vi.setSystemTime(new Date("2025-01-06T15:00:00Z"));

const fakeTime = new Date();
console.log("Fake time UTC:", fakeTime.toISOString());

const fakeParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "numeric",
  hour12: false,
}).formatToParts(fakeTime);

console.log("Fake ET:", fakeParts.find((p) => p.type === "hour")?.value, ":", fakeParts.find((p) => p.type === "minute")?.value);

vi.useRealTimers();
