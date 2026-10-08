import { redirect } from "next/navigation";
import { LOGIN_PATH } from "@/lib/auth/redirect";
import { loadDashboard } from "@/lib/dashboard/load";
import { resolveCategory } from "@/lib/dashboard/url";
import { totalsByBank, totalsByCategory } from "@/lib/domain/breakdown";
import { shiftDay } from "@/lib/domain/day";
import { shiftMonth } from "@/lib/domain/month";
import { monthOfDay, periodLabel, presetPeriods, resolvePeriod } from "@/lib/domain/period";
import type { Category } from "@/lib/domain/types";
import { createClient } from "@/lib/supabase/server";
import { MAX_HISTORY_DAYS } from "@/lib/sync/requests";
import { BankSummary } from "./bank-summary";
import { CategoryBars } from "./category-bars";
import { HistoryImport } from "./history-import";
import { KpiCards } from "./kpi-cards";
import { MonthPicker } from "./month-picker";
import { MonthlyTrend } from "./monthly-trend";
import { RangePicker } from "./range-picker";
import { SyncButton } from "./sync-button";
import { TransactionsTable } from "./transactions-table";

export const metadata = { title: "Bills Management" };

interface AppHomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Dashboard for `?month=YYYY-MM` (the current month by default) or a custom range
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD`. `?category=` limits the bank and card summary and the
 * transactions table to one category.
 */
export default async function AppHome({ searchParams }: AppHomeProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The middleware already guards /app; this check is a second line.
  if (!user) redirect(LOGIN_PATH);

  const now = new Date();
  const params = await searchParams;
  const period = resolvePeriod(params, now);
  const category = resolveCategory(params.category);
  const data = await loadDashboard(supabase, user.id, period, now);
  const categories = totalsByCategory(data.transactions, data.usdToDopRate);
  const previousCategories = new Map<Category, number>(
    totalsByCategory(data.previousTransactions, data.usdToDopRate).map((t) => [
      t.category,
      t.totalDop,
    ]),
  );
  const banks = totalsByBank(data.transactions, data.usdToDopRate, category);
  const { today } = data;

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">{periodLabel(period)}</h2>
          <MonthPicker
            month={period.kind === "month" ? period.month : monthOfDay(period.to)}
            maxMonth={data.maxMonth}
            category={category}
          />
        </div>
        <RangePicker
          key={`${period.kind}:${period.from}:${period.to}`}
          period={period}
          presets={presetPeriods(now)}
          today={today}
          category={category}
        />
      </div>
      <KpiCards data={data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <CategoryBars
            period={period}
            totals={categories}
            selected={category}
            previous={previousCategories}
          />
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <BankSummary period={period} totals={banks} category={category} />
        </div>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <MonthlyTrend trend={data.trend} period={period} />
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <TransactionsTable
          period={period}
          transactions={data.transactions}
          usdToDopRate={data.usdToDopRate}
          category={category}
        />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SyncButton />
        <HistoryImport
          defaultSince={`${shiftMonth(data.maxMonth, -6)}-01`}
          minSince={shiftDay(today, 1 - MAX_HISTORY_DAYS)}
          maxSince={today}
        />
      </div>
    </>
  );
}
