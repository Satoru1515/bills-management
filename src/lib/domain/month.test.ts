import { describe, expect, it } from "vitest";
import {
  currentMonth,
  daysInMonth,
  elapsedDays,
  formatDayTime,
  formatMonthLabel,
  formatMonthName,
  isMonth,
  resolveMonth,
  shiftMonth,
} from "./month";

// 2026-10-07 15:00 in the Dominican Republic.
const NOW = new Date("2026-10-07T19:00:00Z");

describe("isMonth", () => {
  it("accepts YYYY-MM only", () => {
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-01")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-00")).toBe(false);
    expect(isMonth("2026-1")).toBe(false);
    expect(isMonth("2026-10-01")).toBe(false);
    expect(isMonth("")).toBe(false);
  });
});

describe("currentMonth", () => {
  it("uses Dominican Republic time", () => {
    expect(currentMonth(NOW)).toBe("2026-10");
    // 00:30 UTC on Nov 1 is still Oct 31 in Santo Domingo.
    expect(currentMonth(new Date("2026-11-01T00:30:00Z"))).toBe("2026-10");
    expect(currentMonth(new Date("2026-11-01T04:00:00Z"))).toBe("2026-11");
  });
});

describe("shiftMonth", () => {
  it("moves across year boundaries", () => {
    expect(shiftMonth("2026-10", -1)).toBe("2026-09");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", -22)).toBe("2024-12");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });

  it("rejects malformed months", () => {
    expect(() => shiftMonth("2026-13", 1)).toThrow(RangeError);
  });
});

describe("daysInMonth", () => {
  it("handles month lengths and leap years", () => {
    expect(daysInMonth("2026-10")).toBe(31);
    expect(daysInMonth("2026-09")).toBe(30);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
  });
});

describe("elapsedDays", () => {
  it("counts today for the current month", () => {
    expect(elapsedDays("2026-10", NOW)).toBe(7);
    expect(elapsedDays("2026-10", new Date("2026-10-01T04:00:00Z"))).toBe(1);
  });

  it("counts every day of a past month and none of a future one", () => {
    expect(elapsedDays("2026-09", NOW)).toBe(30);
    expect(elapsedDays("2025-02", NOW)).toBe(28);
    expect(elapsedDays("2026-11", NOW)).toBe(0);
  });
});

describe("resolveMonth", () => {
  it("keeps a valid past or current month", () => {
    expect(resolveMonth("2026-09", NOW)).toBe("2026-09");
    expect(resolveMonth("2026-10", NOW)).toBe("2026-10");
    expect(resolveMonth(["2025-12", "2026-01"], NOW)).toBe("2025-12");
  });

  it("falls back to the current month", () => {
    expect(resolveMonth(undefined, NOW)).toBe("2026-10");
    expect(resolveMonth("", NOW)).toBe("2026-10");
    expect(resolveMonth("october", NOW)).toBe("2026-10");
    expect(resolveMonth("2026-11", NOW)).toBe("2026-10");
    expect(resolveMonth([], NOW)).toBe("2026-10");
  });
});

describe("formatMonthLabel", () => {
  it("names the month in English", () => {
    expect(formatMonthLabel("2026-10")).toBe("October 2026");
    expect(formatMonthLabel("2027-01")).toBe("January 2027");
    expect(formatMonthName("2026-09")).toBe("September");
  });
});

describe("formatDayTime", () => {
  it("shows the day and a 12-hour time in DR time", () => {
    expect(formatDayTime("2026-10-04T19:35:00-04:00")).toEqual({ day: "Oct 4", time: "7:35 PM" });
    expect(formatDayTime("2026-10-04T00:05:00-04:00")).toEqual({ day: "Oct 4", time: "12:05 AM" });
    expect(formatDayTime("2026-10-04T12:00:00-04:00")).toEqual({ day: "Oct 4", time: "12:00 PM" });
    expect(formatDayTime("2026-01-15T09:07:00-04:00")).toEqual({ day: "Jan 15", time: "9:07 AM" });
  });

  it("converts other offsets to DR time", () => {
    // 03:59 UTC on Nov 1 is 23:59 on Oct 31 in Santo Domingo.
    expect(formatDayTime("2026-11-01T03:59:00+00:00")).toEqual({
      day: "Oct 31",
      time: "11:59 PM",
    });
  });

  it("returns null for an unparseable date", () => {
    expect(formatDayTime("not a date")).toBeNull();
  });
});
