"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { dashboardHref } from "@/lib/dashboard/url";
import { isDay } from "@/lib/domain/day";
import { rangePeriod, samePeriod, type Period } from "@/lib/domain/period";
import type { Category } from "@/lib/domain/types";

interface RangePickerProps {
  /** The period on screen. */
  period: Period;
  /** Quick choices, e.g. "Last 6 months". */
  presets: readonly { label: string; period: Period }[];
  /** Today (`YYYY-MM-DD`): the latest day that can be picked. */
  today: string;
  /** Category filter kept when changing the period. */
  category?: Category | null;
}

const CHIP = "rounded-full border border-border px-3 py-1 text-xs font-medium";

/**
 * "Advanced filters", collapsed by default: quick ranges and a custom From / To range, both
 * navigating to `?from=&to=`.
 */
export function RangePicker({ period, presets, today, category = null }: RangePickerProps) {
  const router = useRouter();
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to > today ? today : period.to);
  const valid = isDay(from) && isDay(to) && from <= to && to <= today;

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (valid) router.push(dashboardHref(rangePeriod(from, to), { category }));
  }

  return (
    <details className="group text-sm">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium text-muted select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="inline-block text-xs transition-transform group-open:rotate-90"
        >
          ▸
        </span>
        Advanced filters
        {period.kind === "range" && <span className="font-normal"> · custom range</span>}
      </summary>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <nav aria-label="Quick ranges" className="flex flex-wrap gap-2">
          {presets.map((preset) => {
            const active = samePeriod(preset.period, period);
            return (
              <Link
                key={preset.label}
                href={dashboardHref(preset.period, { category })}
                aria-current={active ? "true" : undefined}
                className={`${CHIP} ${active ? "border-accent bg-accent-soft" : "hover:bg-accent-soft"}`}
              >
                {preset.label}
              </Link>
            );
          })}
        </nav>
        <form onSubmit={apply} aria-label="Custom range" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            From
            <input
              type="date"
              required
              value={from}
              max={to || today}
              onChange={(event) => setFrom(event.target.value)}
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            To
            <input
              type="date"
              required
              value={to}
              min={from}
              max={today}
              onChange={(event) => setTo(event.target.value)}
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground tabular-nums"
            />
          </label>
          <button
            type="submit"
            disabled={!valid}
            className="h-9 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-accent-soft disabled:opacity-60"
          >
            Show range
          </button>
        </form>
      </div>
    </details>
  );
}
