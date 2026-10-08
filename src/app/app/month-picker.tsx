"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { dashboardHref } from "@/lib/dashboard/url";
import { formatMonthLabel, isMonth, shiftMonth } from "@/lib/domain/month";
import type { Category } from "@/lib/domain/types";

interface MonthPickerProps {
  /** The month shown, `YYYY-MM`. */
  month: string;
  /** The latest month that can be picked (the current one). */
  maxMonth: string;
  /** Category filter kept when moving between months. */
  category?: Category | null;
}

const STEP =
  "inline-flex size-9 items-center justify-center rounded-md border border-border bg-surface text-lg leading-none";

/** Previous / next arrows around a native month input; every change navigates to `?month=`. */
export function MonthPicker({ month, maxMonth, category = null }: MonthPickerProps) {
  const router = useRouter();
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const hasNext = next <= maxMonth;

  function pick(value: string) {
    if (isMonth(value) && value <= maxMonth && value !== month) {
      router.push(dashboardHref(value, { category }));
    }
  }

  return (
    <nav aria-label="Month" className="flex items-center gap-2">
      <Link
        href={dashboardHref(previous, { category })}
        className={`${STEP} hover:bg-accent-soft`}
        aria-label={`Previous month, ${formatMonthLabel(previous)}`}
      >
        ‹
      </Link>
      <input
        type="month"
        aria-label="Month to show"
        value={month}
        max={maxMonth}
        onChange={(event) => pick(event.target.value)}
        className="h-9 rounded-md border border-border bg-surface px-2 text-sm tabular-nums"
      />
      {hasNext ? (
        <Link
          href={dashboardHref(next, { category })}
          className={`${STEP} hover:bg-accent-soft`}
          aria-label={`Next month, ${formatMonthLabel(next)}`}
        >
          ›
        </Link>
      ) : (
        <span className={`${STEP} opacity-30`} aria-hidden="true">
          ›
        </span>
      )}
    </nav>
  );
}
