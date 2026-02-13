export type TimeOfDay = "premarket" | "open_drive" | "morning" | "midday" | "power_hour" | "close";

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
