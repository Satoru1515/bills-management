import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { monthPeriod, rangePeriod } from "@/lib/domain/period";
import type { MonthTotal } from "@/lib/domain/summary";
import { MonthlyTrend } from "./monthly-trend";

const TREND: MonthTotal[] = [
  { month: "2026-08", totalDop: 2000, count: 4, change: null },
  { month: "2026-09", totalDop: 1000, count: 2, change: -0.5 },
  { month: "2026-10", totalDop: 1500, count: 3, change: 0.5 },
];

describe("MonthlyTrend", () => {
  it("lists the newest month first with its change, colored by direction", () => {
    render(<MonthlyTrend trend={TREND} period={monthPeriod("2026-10")} />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "October 2026: RD$ 1,500.00, +50.0% vs the month before",
      "September 2026: RD$ 1,000.00, −50.0% vs the month before",
      "August 2026: RD$ 2,000.00, no previous month to compare",
    ]);
    expect(links[0]).toHaveAttribute("href", "/app?month=2026-10");
    expect(links[0]).toHaveAttribute("aria-current", "true");
    expect(links[1]).not.toHaveAttribute("aria-current");
    expect(within(links[0]!).getByTitle("more spending")).toHaveClass("text-red-600");
    expect(within(links[1]!).getByTitle("less spending")).toHaveClass("text-emerald-600");

    const bars = links.map((link) => link.querySelector<HTMLElement>("[aria-hidden] > span"));
    expect(bars.map((bar) => bar?.style.width)).toEqual(["75%", "50%", "100%"]);
  });

  it("highlights every month of a custom range without marking one as current", () => {
    render(<MonthlyTrend trend={TREND} period={rangePeriod("2026-09-15", "2026-10-07")} />);
    const links = screen.getAllByRole("link");
    expect(links.filter((link) => link.hasAttribute("aria-current"))).toHaveLength(0);
    expect(links[0]).toHaveClass("bg-accent-soft/50");
    expect(links[1]).toHaveClass("bg-accent-soft/50");
    expect(links[2]).not.toHaveClass("bg-accent-soft/50");
  });
});
