/**
 * `YYYY-MM` months in Dominican Republic time, as stored in `transactions.month`.
 * Pure helpers: the current time is always passed in.
 */

import { toDrParts } from "@/lib/parsers/shared";

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function isMonth(value: string): boolean {
  return MONTH_RE.test(value);
}

function partsOf(month: string): { year: number; month: number } {
  const match = MONTH_RE.exec(month);
  if (!match) throw new RangeError(`invalid month "${month}", expected YYYY-MM`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function format(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** The month `now` falls in, in Dominican Republic time. */
export function currentMonth(now: Date): string {
  const parts = toDrParts(now.toISOString());
  if (!parts) throw new RangeError("invalid date");
  return format(parts.year, parts.month);
}

/** The month `delta` months after (or before, if negative) `month`. */
export function shiftMonth(month: string, delta: number): string {
  const { year, month: m } = partsOf(month);
  const index = year * 12 + (m - 1) + delta;
  return format(Math.floor(index / 12), (((index % 12) + 12) % 12) + 1);
}

export function daysInMonth(month: string): number {
  const { year, month: m } = partsOf(month);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/**
 * Days of `month` that have started by `now` (DR time), today included: every day for a
 * past month, today's day number for the current month, 0 for a future month.
 */
export function elapsedDays(month: string, now: Date): number {
  const current = currentMonth(now);
  if (month < current) return daysInMonth(month);
  if (month > current) return 0;
  return toDrParts(now.toISOString())?.day ?? 0;
}

/**
 * The month to show for a `?month=` query value: a valid month up to the current one, or
 * the current month when it is missing, malformed or in the future.
 */
export function resolveMonth(value: string | string[] | undefined, now: Date): string {
  const current = currentMonth(now);
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === undefined || !isMonth(candidate) || candidate > current) return current;
  return candidate;
}

/** `2026-10` → `October 2026`. */
export function formatMonthLabel(month: string): string {
  const { year, month: m } = partsOf(month);
  return `${MONTH_NAMES[m - 1]} ${year}`;
}

/** `2026-10` → `October`. */
export function formatMonthName(month: string): string {
  return MONTH_NAMES[partsOf(month).month - 1];
}

/**
 * Day and time of an ISO timestamp in Dominican Republic time:
 * `2026-10-04T19:35:00-04:00` → `{ day: "Oct 4", time: "7:35 PM" }`. Null if unparseable.
 */
export function formatDayTime(iso: string): { day: string; time: string } | null {
  const parts = toDrParts(iso);
  if (!parts) return null;
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  const period = parts.hour < 12 ? "AM" : "PM";
  return {
    day: `${MONTH_NAMES[parts.month - 1].slice(0, 3)} ${parts.day}`,
    time: `${hour12}:${String(parts.minute).padStart(2, "0")} ${period}`,
  };
}
