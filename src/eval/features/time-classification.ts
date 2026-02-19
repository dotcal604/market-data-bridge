export type TimeOfDay = "premarket" | "open_drive" | "morning" | "midday" | "power_hour" | "close";

/**
 * Classify the current time into a trading session bucket.
 * Handles DST conversion for US Eastern Time.
 * @param now Current date object
 * @returns Time of day classification
 */
export function classifyTimeOfDay(now: Date): TimeOfDay {
  const etOffset = isUSEasternDST(now) ? -4 : -5;
  const etHours = (now.getUTCHours() + etOffset + 24) % 24;
  const etMinutes = now.getUTCMinutes();
  const totalMinutes = etHours * 60 + etMinutes;
  if (totalMinutes < 570) return "premarket";
  if (totalMinutes < 600) return "open_drive";
  if (totalMinutes < 720) return "morning";
  if (totalMinutes < 870) return "midday";
  if (totalMinutes < 955) return "power_hour";
  return "close";
}

/**
 * Calculate minutes elapsed since market open (9:30 AM ET).
 * Negative values indicate pre-market.
 * @param now Current date object
 * @returns Minutes since 9:30 AM ET
 */
export function minutesSinceOpen(now: Date): number {
  const etOffset = isUSEasternDST(now) ? -4 : -5;
  const etHours = (now.getUTCHours() + etOffset + 24) % 24;
  const etMinutes = now.getUTCMinutes();
  return etHours * 60 + etMinutes - 570;
}

function isUSEasternDST(date: Date): boolean {
  const year = date.getUTCFullYear();
  const marchSecondSunday = getNthSunday(year, 2, 2);
  const novFirstSunday = getNthSunday(year, 10, 1);
  return date >= marchSecondSunday && date < novFirstSunday;
}

function getNthSunday(year: number, month: number, n: number): Date {
  const d = new Date(Date.UTC(year, month, 1));
  let count = 0;
  while (count < n) {
    if (d.getUTCDay() === 0) count++;
    if (count < n) d.setUTCDate(d.getUTCDate() + 1);
  }
  d.setUTCHours(7, 0, 0, 0);
  return d;
}
