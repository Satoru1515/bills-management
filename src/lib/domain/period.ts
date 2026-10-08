/**
 * The span of days the dashboard shows: a calendar month (`?month=YYYY-MM`) or a custom range
 * of days (`?from=YYYY-MM-DD&to=YYYY-MM-DD`), both in Dominican Republic time. Pure helpers:
 * the current time is always passed in. Safe to import from browser code.
 */

import { currentDay, dayOf, daysInclusive, formatDay, isDay, shiftDay } from "./day";
import {
  currentMonth,
  daysInMonth,
  formatMonthLabel,
  formatMonthName,
  isMonth,
  shiftMonth,
} from "./month";

/** Both ends included. */
export type Period =
  | { kind: "month"; month: string; from: string; to: string }
  | { kind: "range"; from: string; to: string };

/** A custom range is limited to this many days (about five years). */
export const MAX_RANGE_DAYS = 5 * 366;

export function monthPeriod(month: string): Period {
  if (!isMonth(month)) throw new RangeError(`invalid month "${month}", expected YYYY-MM`);
  return {
    kind: "month",
    month,
    from: `${month}-01`,
    to: `${month}-${String(daysInMonth(month)).padStart(2, "0")}`,
  };
}

export function rangePeriod(from: string, to: string): Period {
  if (!isDay(from) || !isDay(to) || from > to) {
    throw new RangeError(`invalid range "${from}" to "${to}"`);
  }
  return { kind: "range", from, to };
}

/** The `YYYY-MM` month a `YYYY-MM-DD` day belongs to. */
export function monthOfDay(day: string): string {
  return day.slice(0, 7);
}

type QueryValue = string | string[] | undefined;

function first(value: QueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The period for the dashboard's query: a valid `from`–`to` range (its end capped at today),
 * else a valid `month` up to the current one, else the current month.
 */
export function resolvePeriod(
  params: { month?: QueryValue; from?: QueryValue; to?: QueryValue },
  now: Date,
): Period {
  const today = currentDay(now);
  const from = first(params.from);
  const to = first(params.to);
  if (from !== undefined && to !== undefined && isDay(from) && isDay(to)) {
    const end = to > today ? today : to;
    if (from <= end && daysInclusive(from, end) <= MAX_RANGE_DAYS) return rangePeriod(from, end);
  }
  const month = first(params.month);
  const current = currentMonth(now);
  if (month !== undefined && isMonth(month) && month <= current) return monthPeriod(month);
  return monthPeriod(current);
}

/** The month before, or the same number of days right before a custom range. */
export function previousPeriod(period: Period): Period {
  if (period.kind === "month") return monthPeriod(shiftMonth(period.month, -1));
  const length = daysInclusive(period.from, period.to);
  return rangePeriod(shiftDay(period.from, -length), shiftDay(period.from, -1));
}

/** Days in the period that have started by `now` (DR time), today included. */
export function elapsedDaysIn(period: Period, now: Date): number {
  const today = currentDay(now);
  if (period.from > today) return 0;
  return daysInclusive(period.from, period.to < today ? period.to : today);
}

/** Whether an ISO timestamp falls inside the period (DR days). */
export function containsDate(period: Period, iso: string): boolean {
  const day = dayOf(iso);
  return day !== null && day >= period.from && day <= period.to;
}

/** `October 2026`, or `Apr 1, 2026 – Oct 8, 2026`. */
export function periodLabel(period: Period): string {
  if (period.kind === "month") return formatMonthLabel(period.month);
  return `${formatDay(period.from)} – ${formatDay(period.to)}`;
}

/** Short name used in comparisons: `September`, or the range label. */
export function periodName(period: Period): string {
  return period.kind === "month" ? formatMonthName(period.month) : periodLabel(period);
}

/** `this month` or `in this period`, for empty-state messages. */
export function periodPhrase(period: Period): string {
  return period.kind === "month" ? "this month" : "in this period";
}

/** Query parameters that select the period. */
export function periodParams(period: Period): Record<string, string> {
  return period.kind === "month" ? { month: period.month } : { from: period.from, to: period.to };
}

/** Months from `fromMonth` to `toMonth`, both included (empty if reversed). */
export function monthsBetween(fromMonth: string, toMonth: string): string[] {
  const months: string[] = [];
  for (let m = fromMonth; m <= toMonth; m = shiftMonth(m, 1)) months.push(m);
  return months;
}

/** The monthly trend shows at least this many months. */
export const TREND_MIN_MONTHS = 6;
/** ...and at most this many. */
export const TREND_MAX_MONTHS = 24;

/**
 * Months of the monthly trend: those the period touches, extended back to
 * {@link TREND_MIN_MONTHS} and capped at the latest {@link TREND_MAX_MONTHS}.
 */
export function trendMonths(period: Period): string[] {
  const end = monthOfDay(period.to);
  const start = monthOfDay(period.from);
  const minStart = shiftMonth(end, 1 - TREND_MIN_MONTHS);
  const maxStart = shiftMonth(end, 1 - TREND_MAX_MONTHS);
  const from = start < minStart ? (start < maxStart ? maxStart : start) : minStart;
  return monthsBetween(from, end);
}

/** Quick choices: this month, the last 3 and 6 months and the year so far (ranges end today). */
export function presetPeriods(now: Date): { label: string; period: Period }[] {
  const today = currentDay(now);
  const month = currentMonth(now);
  return [
    { label: "This month", period: monthPeriod(month) },
    { label: "Last 3 months", period: rangePeriod(`${shiftMonth(month, -2)}-01`, today) },
    { label: "Last 6 months", period: rangePeriod(`${shiftMonth(month, -5)}-01`, today) },
    { label: "This year", period: rangePeriod(`${month.slice(0, 4)}-01-01`, today) },
  ];
}

/** Whether two periods select the same days the same way. */
export function samePeriod(a: Period, b: Period): boolean {
  return a.kind === b.kind && a.from === b.from && a.to === b.to;
}
