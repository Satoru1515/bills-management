import type { DashboardData } from "@/lib/dashboard/load";
import { formatChange, formatMoney, formatRate } from "@/lib/domain/money";
import { formatMonthName } from "@/lib/domain/month";

interface Kpi {
  label: string;
  value: string;
  hint: string;
  wide?: boolean;
}

function purchases(count: number): string {
  return count === 1 ? "1 purchase" : `${count} purchases`;
}

/** The month's headline figures. Amounts use tabular numbers so columns line up. */
export function KpiCards({ data }: { data: DashboardData }) {
  const { current, previous, change, usdToDopRate, defaultRate } = data;
  const previousName = formatMonthName(previous.month);

  const kpis: Kpi[] = [
    {
      label: "Total",
      value: formatMoney(current.totalDop, "DOP"),
      hint:
        `US$ at ${formatRate(usdToDopRate)}${defaultRate ? " (default rate)" : ""}` +
        (current.ignoredCount > 0 ? ` · ${current.ignoredCount} ignored` : ""),
      wide: true,
    },
    {
      label: "In pesos",
      value: formatMoney(current.dop, "DOP"),
      hint: purchases(current.dopCount),
    },
    {
      label: "In dollars",
      value: formatMoney(current.usd, "USD"),
      hint: purchases(current.usdCount),
    },
    {
      label: "Daily average",
      value: current.dailyAverage === null ? "—" : formatMoney(current.dailyAverage, "DOP"),
      hint: current.days === 1 ? "over 1 day" : `over ${current.days} days`,
    },
    {
      label: `vs ${previousName}`,
      value: change === null ? "—" : formatChange(change),
      hint: `${previousName}: ${formatMoney(previous.totalDop, "DOP")}`,
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className={`flex flex-col gap-1 rounded-lg border border-current/10 p-4 ${
            kpi.wide ? "col-span-2 sm:col-span-3 lg:col-span-1" : ""
          }`}
        >
          <dt className="text-xs font-medium tracking-wide uppercase opacity-70">{kpi.label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{kpi.value}</dd>
          <dd className="text-xs tabular-nums opacity-70">{kpi.hint}</dd>
        </div>
      ))}
    </dl>
  );
}
