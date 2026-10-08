/**
 * Monthly spending figures for the dashboard KPI cards.
 */

import { fromCents, toCents, toDop } from "./money";
import { elapsedDays } from "./month";
import type { Transaction } from "./types";

export interface MonthSummary {
  month: string;
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
  /** Days of the month elapsed so far (all of them for a past month). */
  days: number;
  /** `totalDop / days`; null when no day of the month has started. */
  dailyAverage: number | null;
}

export interface SummaryOptions {
  month: string;
  usdToDopRate: number;
  now: Date;
}

/** Sums the month's transactions that are not ignored. Transactions of other months are skipped. */
export function summarizeMonth(
  transactions: readonly Transaction[],
  { month, usdToDopRate, now }: SummaryOptions,
): MonthSummary {
  let dopCents = 0;
  let usdCents = 0;
  let totalCents = 0;
  let dopCount = 0;
  let usdCount = 0;
  let ignoredCount = 0;

  for (const transaction of transactions) {
    if (transaction.month !== month) continue;
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

  const days = elapsedDays(month, now);
  return {
    month,
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
