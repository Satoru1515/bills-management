/**
 * Everything the dashboard needs for one month, read with the signed-in user's client.
 */

import { DEFAULT_USD_TO_DOP_RATE, relativeChange } from "@/lib/domain/money";
import { currentMonth, shiftMonth } from "@/lib/domain/month";
import { summarizeMonth, type MonthSummary } from "@/lib/domain/summary";
import type { Transaction } from "@/lib/domain/types";
import { getUsdToDopRate } from "@/lib/repo/profiles";
import { listByMonth, type DbClient } from "@/lib/repo/transactions";

export interface DashboardData {
  month: string;
  /** The latest month that can be shown (the current one, DR time). */
  maxMonth: string;
  usdToDopRate: number;
  /** True when the user has not set a rate and the app default is used. */
  defaultRate: boolean;
  current: MonthSummary;
  previous: MonthSummary;
  /** Change of `current.totalDop` against the whole previous month; null if that was 0. */
  change: number | null;
  /** The month's transactions, newest first, ignored ones included. */
  transactions: Transaction[];
}

export async function loadDashboard(
  client: DbClient,
  userId: string,
  month: string,
  now: Date,
): Promise<DashboardData> {
  const previousMonth = shiftMonth(month, -1);
  const [transactions, previousTransactions, savedRate] = await Promise.all([
    listByMonth(client, userId, month),
    listByMonth(client, userId, previousMonth),
    getUsdToDopRate(client, userId),
  ]);

  const usdToDopRate = savedRate ?? DEFAULT_USD_TO_DOP_RATE;
  const current = summarizeMonth(transactions, { month, usdToDopRate, now });
  const previous = summarizeMonth(previousTransactions, {
    month: previousMonth,
    usdToDopRate,
    now,
  });

  return {
    month,
    maxMonth: currentMonth(now),
    usdToDopRate,
    defaultRate: savedRate === null,
    current,
    previous,
    change: relativeChange(current.totalDop, previous.totalDop),
    transactions,
  };
}
