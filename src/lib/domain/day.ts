/**
 * `YYYY-MM-DD` calendar days in Dominican Republic time. Pure helpers: the current time is
 * always passed in.
 */

import { toDrParts } from "@/lib/parsers/shared";

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Whether `value` is a real calendar day written `YYYY-MM-DD`. */
export function isDay(value: string): boolean {
  const match = DAY_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function toUtcMs(day: string): number {
  if (!isDay(day)) throw new RangeError(`invalid day "${day}", expected YYYY-MM-DD`);
  return Date.parse(`${day}T00:00:00Z`);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The day `now` falls on, in Dominican Republic time. */
export function currentDay(now: Date): string {
  const parts = toDrParts(now.toISOString());
  if (!parts) throw new RangeError("invalid date");
  return fromUtcMs(Date.UTC(parts.year, parts.month - 1, parts.day));
}

/** The day `delta` days after (or before, if negative) `day`. */
export function shiftDay(day: string, delta: number): string {
  return fromUtcMs(toUtcMs(day) + delta * DAY_MS);
}

/** Days from `from` to `to`, both included (0 when `to` is before `from`). */
export function daysInclusive(from: string, to: string): number {
  return Math.max(0, Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS) + 1);
}

/** The DR day of an ISO timestamp: `2026-10-04T23:30:00-04:00` → `2026-10-04`. Null if invalid. */
export function dayOf(iso: string): string | null {
  const parts = toDrParts(iso);
  return parts ? fromUtcMs(Date.UTC(parts.year, parts.month - 1, parts.day)) : null;
}

/** `2026-10-04` → `Oct 4, 2026`. */
export function formatDay(day: string): string {
  const date = new Date(toUtcMs(day));
  return `${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}
