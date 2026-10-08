import Link from "next/link";
import { dashboardHref } from "@/lib/dashboard/url";
import type { CategoryTotal } from "@/lib/domain/breakdown";
import { formatChange, formatMoney, relativeChange } from "@/lib/domain/money";
import { periodPhrase, type Period } from "@/lib/domain/period";
import type { Category } from "@/lib/domain/types";
import { ChangeBadge } from "./change-badge";

interface CategoryBarsProps {
  period: Period;
  totals: readonly CategoryTotal[];
  /** The category the page is filtered by, if any. */
  selected: Category | null;
  /**
   * Spending per category in the previous period. When given, each bar shows its change:
   * red if the category grew, green if it shrank.
   */
  previous?: ReadonlyMap<Category, number>;
}

function changeLabel(previous: boolean, change: number | null): string {
  if (!previous) return "";
  return change === null ? ", new" : `, ${formatChange(change)} vs before`;
}

const SHARE_FORMAT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

/** One bar per category, largest first. A bar links to the page filtered by it (again to clear). */
export function CategoryBars({ period, totals, selected, previous }: CategoryBarsProps) {
  const max = totals[0]?.totalDop ?? 0;

  return (
    <section aria-labelledby="by-category" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="by-category" className="text-sm font-semibold">
          By category
        </h3>
        {selected && (
          <Link
            href={dashboardHref(period)}
            className="text-xs text-accent underline underline-offset-4"
          >
            Show all categories
          </Link>
        )}
      </div>
      {totals.length === 0 ? (
        <p className="text-sm text-muted">No purchases {periodPhrase(period)}.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {totals.map((total) => {
            const active = total.category === selected;
            const dimmed = selected !== null && !active;
            const width = max > 0 ? (total.totalDop / max) * 100 : 0;
            const change = previous
              ? relativeChange(total.totalDop, previous.get(total.category) ?? 0)
              : null;
            return (
              <li key={total.category}>
                <Link
                  href={dashboardHref(period, { category: active ? null : total.category })}
                  aria-current={active ? "true" : undefined}
                  aria-label={`${total.category}: ${formatMoney(total.totalDop, "DOP")}, ${
                    total.count === 1 ? "1 purchase" : `${total.count} purchases`
                  }${changeLabel(!!previous, change)}${active ? " (selected, show all)" : ""}`}
                  className={`group flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-accent-soft/60 ${
                    active ? "bg-accent-soft" : ""
                  } ${dimmed ? "opacity-55" : ""}`}
                >
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{total.category}</span>
                    <span className="shrink-0 tabular-nums">
                      {previous &&
                        (change === null ? (
                          <span className="mr-2 text-xs text-muted">new</span>
                        ) : (
                          <ChangeBadge change={change} className="mr-2 text-xs" />
                        ))}
                      {formatMoney(total.totalDop, "DOP")}
                      <span className="ml-2 inline-block w-9 text-right text-xs text-muted">
                        {SHARE_FORMAT.format(total.share)}
                      </span>
                    </span>
                  </span>
                  <span aria-hidden="true" className="h-1.5 w-full rounded-full bg-border/70">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${Math.max(width, 1)}%` }}
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
