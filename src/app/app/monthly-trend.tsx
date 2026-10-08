import Link from "next/link";
import { dashboardHref } from "@/lib/dashboard/url";
import { formatChange, formatMoney } from "@/lib/domain/money";
import { formatMonthLabel } from "@/lib/domain/month";
import { monthOfDay, type Period } from "@/lib/domain/period";
import type { MonthTotal } from "@/lib/domain/summary";
import { ChangeBadge } from "./change-badge";

interface MonthlyTrendProps {
  /** Ascending months. */
  trend: readonly MonthTotal[];
  /** The period on screen; its months are highlighted. */
  period: Period;
}

/**
 * Spending per month with the change against the month before: red when it went up, green
 * when it went down. Each month links to its own dashboard.
 */
export function MonthlyTrend({ trend, period }: MonthlyTrendProps) {
  const max = Math.max(0, ...trend.map((m) => m.totalDop));
  const first = monthOfDay(period.from);
  const last = monthOfDay(period.to);
  const months = [...trend].reverse();

  return (
    <section aria-labelledby="monthly-trend" className="flex flex-col gap-3">
      <h3 id="monthly-trend" className="text-sm font-semibold">
        Month by month
        <span className="font-normal text-muted"> · change vs the month before</span>
      </h3>
      <ul className="flex flex-col gap-1">
        {months.map((month) => {
          const inPeriod = month.month >= first && month.month <= last;
          const width = max > 0 ? (month.totalDop / max) * 100 : 0;
          const label = formatMonthLabel(month.month);
          return (
            <li key={month.month}>
              <Link
                href={dashboardHref(month.month)}
                aria-current={period.kind === "month" && inPeriod ? "true" : undefined}
                aria-label={`${label}: ${formatMoney(month.totalDop, "DOP")}, ${
                  month.change === null
                    ? "no previous month to compare"
                    : `${formatChange(month.change)} vs the month before`
                }`}
                className={`flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-accent-soft/60 ${
                  inPeriod ? "bg-accent-soft/50" : ""
                }`}
              >
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{label}</span>
                  <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
                    <ChangeBadge change={month.change} className="text-xs" />
                    <span className="w-28 text-right">{formatMoney(month.totalDop, "DOP")}</span>
                  </span>
                </span>
                <span aria-hidden="true" className="h-1.5 w-full rounded-full bg-border/70">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${month.totalDop > 0 ? Math.max(width, 1) : 0}%` }}
                  />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
