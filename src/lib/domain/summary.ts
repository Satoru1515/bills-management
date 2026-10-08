/**
 * Spending figures for the dashboard: the KPI cards of a period and the monthly trend.
 */

import { fromCents, relativeChange, toCents, toDop } from "./money";
import { shiftMonth } from "./month";
import { containsDate, elapsedDaysIn, type Period } from "./period";
import type { Transaction } from "./types";

export interface PeriodSummary {
  period: Period;
  /** Everything in pesos, dollars converted at `usdToDopRate`. */
  totalDop: number;
  /** Purchases made in pesos. */
  dop: number;
  /** Purchases made in dollars (not converted). */
  usd: number;
  dopCount: number;
  usdCount: number;
  /** Transactions the user hid; not part of any figure above. */
  ignoredCount: number;
  /** Days of the period elapsed so far (all of them for a past period). */
  days: number;
  /** `totalDop / days`; null when no day of the period has started. */
  dailyAverage: number | null;
}

export interface SummaryOptions {
  period: Period;
  usdToDopRate: number;
  now: Date;
}

/** Sums the period's transactions that are not ignored. Transactions outside it are skipped. */
export function summarizePeriod(
  transactions: readonly Transaction[],
  { period, usdToDopRate, now }: SummaryOptions,
): PeriodSummary {
  let dopCents = 0;
  let usdCents = 0;
  let totalCents = 0;
  let dopCount = 0;
  let usdCount = 0;
  let ignoredCount = 0;

  for (const transaction of transactions) {
    if (!containsDate(period, transaction.date)) continue;
    if (transaction.ignored) {
      ignoredCount += 1;
      continue;
    }
    totalCents += toCents(toDop(transaction.amount, transaction.currency, usdToDopRate));
    if (transaction.currency === "DOP") {
      dopCents += toCents(transaction.amount);
      dopCount += 1;
    } else {
      usdCents += toCents(transaction.amount);
      usdCount += 1;
    }
  }

  const days = elapsedDaysIn(period, now);
  return {
    period,
    totalDop: fromCents(totalCents),
    dop: fromCents(dopCents),
    usd: fromCents(usdCents),
    dopCount,
    usdCount,
    ignoredCount,
    days,
    dailyAverage: days > 0 ? fromCents(Math.round(totalCents / days)) : null,
  };
}

export interface MonthTotal {
  month: string;
  /** Pesos, dollars converted; ignored transactions left out. */
  totalDop: number;
  count: number;
  /** Change against the month before; null when that month had no spending. */
  change: number | null;
}

/**
 * Spending of each month in `months` (ascending, consecutive) with its change against the
 * month before. `transactions` should include the month before the first one.
 */
export function monthlyTrend(
  transactions: readonly Transaction[],
  months: readonly string[],
  usdToDopRate: number,
): MonthTotal[] {
  const cents = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.ignored) continue;
    const amount = toCents(toDop(transaction.amount, transaction.currency, usdToDopRate));
    cents.set(transaction.month, (cents.get(transaction.month) ?? 0) + amount);
    counts.set(transaction.month, (counts.get(transaction.month) ?? 0) + 1);
  }

  return months.map((month) => {
    const totalDop = fromCents(cents.get(month) ?? 0);
    const before = fromCents(cents.get(shiftMonth(month, -1)) ?? 0);
    return {
      month,
      totalDop,
      count: counts.get(month) ?? 0,
      change: relativeChange(totalDop, before),
    };
  });
}
