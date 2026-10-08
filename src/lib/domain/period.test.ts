import { describe, expect, it } from "vitest";
import {
  containsDate,
  elapsedDaysIn,
  monthPeriod,
  periodLabel,
  periodName,
  periodParams,
  periodPhrase,
  presetPeriods,
  previousPeriod,
  rangePeriod,
  resolvePeriod,
  samePeriod,
  trendMonths,
} from "./period";

// Wednesday 7 October 2026, 3 PM in the Dominican Republic.
const NOW = new Date("2026-10-07T19:00:00Z");

describe("monthPeriod and rangePeriod", () => {
  it("span every day of a month", () => {
    expect(monthPeriod("2026-02")).toEqual({
      kind: "month",
      month: "2026-02",
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("refuse invalid input", () => {
    expect(() => monthPeriod("2026-13")).toThrow(RangeError);
    expect(() => rangePeriod("2026-10-05", "2026-10-01")).toThrow(RangeError);
    expect(() => rangePeriod("2026-02-30", "2026-03-01")).toThrow(RangeError);
  });
});

describe("resolvePeriod", () => {
  it("prefers a valid range and caps its end at today", () => {
    expect(resolvePeriod({ from: "2026-04-01", to: "2026-12-31", month: "2026-09" }, NOW)).toEqual(
      rangePeriod("2026-04-01", "2026-10-07"),
    );
  });

  it("falls back to the month, then to the current month", () => {
    expect(resolvePeriod({ from: "2026-10-05", to: "2026-10-01", month: "2026-09" }, NOW)).toEqual(
      monthPeriod("2026-09"),
    );
    expect(resolvePeriod({ from: "2026-11-01", to: "2026-11-30" }, NOW)).toEqual(
      monthPeriod("2026-10"),
    );
    expect(resolvePeriod({ month: ["2026-08", "2026-07"] }, NOW)).toEqual(monthPeriod("2026-08"));
    expect(resolvePeriod({ month: "2026-11" }, NOW)).toEqual(monthPeriod("2026-10"));
    expect(resolvePeriod({}, NOW)).toEqual(monthPeriod("2026-10"));
  });

  it("refuses ranges longer than about five years", () => {
    expect(resolvePeriod({ from: "2010-01-01", to: "2026-10-01" }, NOW)).toEqual(
      monthPeriod("2026-10"),
    );
  });
});

describe("previousPeriod", () => {
  it("is the month before, or as many days right before the range", () => {
    expect(previousPeriod(monthPeriod("2026-01"))).toEqual(monthPeriod("2025-12"));
    expect(previousPeriod(rangePeriod("2026-09-01", "2026-09-10"))).toEqual(
      rangePeriod("2026-08-22", "2026-08-31"),
    );
  });
});

describe("elapsedDaysIn", () => {
  it("counts up to today", () => {
    expect(elapsedDaysIn(monthPeriod("2026-10"), NOW)).toBe(7);
    expect(elapsedDaysIn(monthPeriod("2026-09"), NOW)).toBe(30);
    expect(elapsedDaysIn(monthPeriod("2026-11"), NOW)).toBe(0);
    expect(elapsedDaysIn(rangePeriod("2026-10-01", "2026-10-03"), NOW)).toBe(3);
  });
});

describe("containsDate", () => {
  it("compares DR days", () => {
    const period = rangePeriod("2026-09-01", "2026-09-30");
    expect(containsDate(period, "2026-09-30T23:59:00-04:00")).toBe(true);
    expect(containsDate(period, "2026-10-01T02:00:00Z")).toBe(true);
    expect(containsDate(period, "2026-10-01T00:00:00-04:00")).toBe(false);
    expect(containsDate(period, "nope")).toBe(false);
  });
});

describe("labels", () => {
  it("name months and ranges", () => {
    expect(periodLabel(monthPeriod("2026-10"))).toBe("October 2026");
    expect(periodName(monthPeriod("2026-09"))).toBe("September");
    expect(periodLabel(rangePeriod("2026-04-01", "2026-10-07"))).toBe("Apr 1, 2026 – Oct 7, 2026");
    expect(periodPhrase(monthPeriod("2026-10"))).toBe("this month");
    expect(periodPhrase(rangePeriod("2026-04-01", "2026-10-07"))).toBe("in this period");
  });

  it("give the query parameters", () => {
    expect(periodParams(monthPeriod("2026-10"))).toEqual({ month: "2026-10" });
    expect(periodParams(rangePeriod("2026-04-01", "2026-10-07"))).toEqual({
      from: "2026-04-01",
      to: "2026-10-07",
    });
  });
});

describe("trendMonths", () => {
  it("shows at least six months ending with the period", () => {
    expect(trendMonths(monthPeriod("2026-02"))).toEqual([
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("covers a longer range, up to 24 months", () => {
    expect(trendMonths(rangePeriod("2025-11-15", "2026-10-07"))).toHaveLength(12);
    const long = trendMonths(rangePeriod("2022-01-01", "2026-10-07"));
    expect(long).toHaveLength(24);
    expect(long[0]).toBe("2024-11");
    expect(long.at(-1)).toBe("2026-10");
  });
});

describe("presetPeriods", () => {
  it("ends the ranges today", () => {
    expect(presetPeriods(NOW)).toEqual([
      { label: "This month", period: monthPeriod("2026-10") },
      { label: "Last 3 months", period: rangePeriod("2026-08-01", "2026-10-07") },
      { label: "Last 6 months", period: rangePeriod("2026-05-01", "2026-10-07") },
      { label: "This year", period: rangePeriod("2026-01-01", "2026-10-07") },
    ]);
  });
});

describe("samePeriod", () => {
  it("compares kind and days", () => {
    expect(samePeriod(monthPeriod("2026-10"), monthPeriod("2026-10"))).toBe(true);
    expect(samePeriod(monthPeriod("2026-10"), rangePeriod("2026-10-01", "2026-10-31"))).toBe(false);
  });
});
