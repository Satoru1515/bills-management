import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DashboardData } from "@/lib/dashboard/load";
import { monthPeriod, rangePeriod } from "@/lib/domain/period";
import type { PeriodSummary } from "@/lib/domain/summary";
import { KpiCards } from "./kpi-cards";

function summary(overrides: Partial<PeriodSummary>): PeriodSummary {
  return {
    period: monthPeriod("2026-10"),
    totalDop: 0,
    dop: 0,
    usd: 0,
    dopCount: 0,
    usdCount: 0,
    ignoredCount: 0,
    days: 7,
    dailyAverage: 0,
    ...overrides,
  };
}

function data(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    period: monthPeriod("2026-10"),
    maxMonth: "2026-10",
    today: "2026-10-07",
    usdToDopRate: 63,
    defaultRate: false,
    current: summary({
      totalDop: 3865.52,
      dop: 1850.15,
      usd: 31.99,
      dopCount: 2,
      usdCount: 1,
      dailyAverage: 552.22,
    }),
    previous: summary({ period: monthPeriod("2026-09"), totalDop: 3000, days: 30 }),
    change: 0.28851,
    transactions: [],
    previousTransactions: [],
    trend: [],
    ...overrides,
  };
}

/** The value and hint of the card labelled `label`. */
function card(label: string): string[] {
  const term = screen.getByText(label, { selector: "dt" });
  return within(term.parentElement!)
    .getAllByRole("definition")
    .map((node) => node.textContent ?? "");
}

describe("KpiCards", () => {
  it("shows the month's figures", () => {
    render(<KpiCards data={data()} />);

    expect(card("Total")).toEqual(["RD$ 3,865.52", "US$ at 63.00"]);
    expect(card("In pesos")).toEqual(["RD$ 1,850.15", "2 purchases"]);
    expect(card("In dollars")).toEqual(["US$ 31.99", "1 purchase"]);
    expect(card("Daily average")).toEqual(["RD$ 552.22", "over 7 days"]);
    expect(card("vs September")).toEqual(["▲+28.9%", "September: RD$ 3,000.00"]);
  });

  it("colors the change: red for more spending, green for less", () => {
    const { unmount } = render(<KpiCards data={data()} />);
    expect(screen.getByTitle("more spending")).toHaveClass("text-red-600");
    unmount();

    render(<KpiCards data={data({ change: -0.125 })} />);
    expect(card("vs September")[0]).toBe("▼−12.5%");
    expect(screen.getByTitle("less spending")).toHaveClass("text-emerald-600");
  });

  it("compares a custom range with the previous period", () => {
    render(
      <KpiCards
        data={data({
          period: rangePeriod("2026-09-01", "2026-10-07"),
          previous: summary({ period: rangePeriod("2026-07-26", "2026-08-31"), totalDop: 3000 }),
        })}
      />,
    );
    expect(card("vs previous period")).toEqual([
      "▲+28.9%",
      "Jul 26, 2026 – Aug 31, 2026: RD$ 3,000.00",
    ]);
  });

  it("says when the default rate is used and how many were ignored", () => {
    render(
      <KpiCards
        data={data({ defaultRate: true, current: summary({ ignoredCount: 3, days: 1 }) })}
      />,
    );
    expect(card("Total")[1]).toBe("US$ at 63.00 (default rate) · 3 ignored");
    expect(card("Daily average")[1]).toBe("over 1 day");
  });

  it("shows a dash when there is nothing to compare or average", () => {
    render(
      <KpiCards
        data={data({
          change: null,
          current: summary({ days: 0, dailyAverage: null }),
          previous: summary({ period: monthPeriod("2026-09"), totalDop: 0 }),
        })}
      />,
    );
    expect(card("Daily average")[0]).toBe("—");
    expect(card("vs September")).toEqual(["—", "September: RD$ 0.00"]);
  });
});
