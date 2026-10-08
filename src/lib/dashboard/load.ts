/**
 * Everything the dashboard needs for one period, read with the signed-in user's client.
 */

import { currentDay } from "@/lib/domain/day";
import { DEFAULT_USD_TO_DOP_RATE, relativeChange } from "@/lib/domain/money";
import { currentMonth, shiftMonth } from "@/lib/domain/month";
import { containsDate, previousPeriod, trendMonths, type Period } from "@/lib/domain/period";
import {
  monthlyTrend,
  summarizePeriod,
  type MonthTotal,
  type PeriodSummary,
} from "@/lib/domain/summary";
import type { Transaction } from "@/lib/domain/types";
import { getUsdToDopRate } from "@/lib/repo/profiles";
import { listBetween, type DbClient } from "@/lib/repo/transactions";

export interface DashboardData {
  period: Period;
  /** The latest month that can be shown (the current one, DR time). */
  maxMonth: string;
  /** Today, `YYYY-MM-DD` (DR time). */
  today: string;
  usdToDopRate: number;
  /** True when the user has not set a rate and the app default is used. */
  defaultRate: boolean;
  current: PeriodSummary;
  /** The month before, or as many days right before a custom range. */
  previous: PeriodSummary;
  /** Change of `current.totalDop` against the whole previous period; null if that was 0. */
  change: number | null;
  /** The period's transactions, newest first, ignored ones included. */
  transactions: Transaction[];
  /** The previous period's transactions, for per-category comparisons. */
  previousTransactions: Transaction[];
  /** Spending per month (at least six, ending with the period's last month). */
  trend: MonthTotal[];
}

export async function loadDashboard(
  client: DbClient,
  userId: string,
  period: Period,
  now: Date,
): Promise<DashboardData> {
  const before = previousPeriod(period);
  const months = trendMonths(period);
  // One read covers the period, the previous one and the trend (plus the month before it).
  const trendStart = `${shiftMonth(months[0]!, -1)}-01`;
  const from = before.from < trendStart ? before.from : trendStart;
  const [all, savedRate] = await Promise.all([
    listBetween(client, userId, from, period.to),
    getUsdToDopRate(client, userId),
  ]);

  const usdToDopRate = savedRate ?? DEFAULT_USD_TO_DOP_RATE;
  const transactions = all.filter((t) => containsDate(period, t.date));
  const previousTransactions = all.filter((t) => containsDate(before, t.date));
  const current = summarizePeriod(transactions, { period, usdToDopRate, now });
  const previous = summarizePeriod(previousTransactions, { period: before, usdToDopRate, now });

  return {
    period,
    maxMonth: currentMonth(now),
    today: currentDay(now),
    usdToDopRate,
    defaultRate: savedRate === null,
    current,
    previous,
    change: relativeChange(current.totalDop, previous.totalDop),
    transactions,
    previousTransactions,
    trend: monthlyTrend(all, months, usdToDopRate),
  };
}
