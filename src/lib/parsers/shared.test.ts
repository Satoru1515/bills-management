import { describe, expect, it } from "vitest";
import {
  combineReceivedDateWithTime,
  formatDrIso,
  monthOf,
  normalizeText,
  parse24HourTime,
  parseAmount,
  parseDayMonthYear,
  to24Hour,
  toDrParts,
} from "./shared";

describe("normalizeText", () => {
  it("collapses line breaks, tabs and non-breaking spaces", () => {
    expect(normalizeText("  terminada\n en \t9236 \r\n")).toBe("terminada en 9236");
  });
});

describe("parseAmount", () => {
  it.each([
    ["5,986.90", 5986.9],
    ["920.00", 920],
    ["1,234,567.5", 1234567.5],
    ["394", 394],
  ])("parses %s", (text, expected) => {
    expect(parseAmount(text)).toBe(expected);
  });

  it.each(["", "abc", "12.345", "-5.00"])("rejects %j", (text) => {
    expect(parseAmount(text)).toBeNull();
  });
});

describe("to24Hour", () => {
  it.each([
    ["07:35", "pm", 19, 35],
    ["12:59", "pm", 12, 59],
    ["12:05", "am", 0, 5],
    ["9:00", "AM", 9, 0],
  ])("converts %s %s", (time, meridiem, hour, minute) => {
    expect(to24Hour(time, meridiem)).toEqual({ hour, minute });
  });

  it.each([
    ["13:00", "pm"],
    ["0:30", "am"],
    ["7:60", "am"],
    ["7.30", "am"],
  ])("rejects %s %s", (time, meridiem) => {
    expect(to24Hour(time, meridiem)).toBeNull();
  });
});

describe("Dominican Republic dates", () => {
  it("formats date parts with the -04:00 offset", () => {
    const iso = formatDrIso({ year: 2026, month: 3, day: 7, hour: 8, minute: 5, second: 9 });
    expect(iso).toBe("2026-03-07T08:05:09-04:00");
    expect(monthOf(iso)).toBe("2026-03");
  });

  it("converts a UTC timestamp to local parts across midnight", () => {
    expect(toDrParts("2026-10-01T02:30:00Z")).toEqual({
      year: 2026,
      month: 9,
      day: 30,
      hour: 22,
      minute: 30,
      second: 0,
    });
  });

  it("returns null for an invalid timestamp", () => {
    expect(toDrParts("yesterday")).toBeNull();
  });
});

describe("combineReceivedDateWithTime", () => {
  it("keeps the receive day when the stated time is earlier", () => {
    expect(combineReceivedDateWithTime("2026-10-04T23:35:41Z", 19, 35)).toBe(
      "2026-10-04T19:35:00-04:00",
    );
  });

  it("tolerates a stated time a few minutes after reception", () => {
    expect(combineReceivedDateWithTime("2026-10-04T23:35:00Z", 19, 40)).toBe(
      "2026-10-04T19:40:00-04:00",
    );
  });

  it("moves to the previous day (and month) when the time is after reception", () => {
    expect(combineReceivedDateWithTime("2026-11-01T04:01:00Z", 23, 58)).toBe(
      "2026-10-31T23:58:00-04:00",
    );
  });

  it("returns null for an invalid receive date", () => {
    expect(combineReceivedDateWithTime("", 10, 0)).toBeNull();
  });
});

describe("parseDayMonthYear", () => {
  it.each([
    ["4/10/2026", { year: 2026, month: 10, day: 4 }],
    ["06/10/2026", { year: 2026, month: 10, day: 6 }],
    [" 31/12/2025 ", { year: 2025, month: 12, day: 31 }],
    ["29/2/2028", { year: 2028, month: 2, day: 29 }],
  ])("parses %j", (text, expected) => {
    expect(parseDayMonthYear(text)).toEqual(expected);
  });

  it.each(["", "2026-10-04", "10/4/26", "31/9/2026", "29/2/2026", "0/10/2026", "4/13/2026"])(
    "rejects %j",
    (text) => {
      expect(parseDayMonthYear(text)).toBeNull();
    },
  );
});

describe("parse24HourTime", () => {
  it.each([
    ["20:7", { hour: 20, minute: 7, second: 0 }],
    ["9:05", { hour: 9, minute: 5, second: 0 }],
    ["0:0", { hour: 0, minute: 0, second: 0 }],
    ["23:18:05", { hour: 23, minute: 18, second: 5 }],
  ])("parses %j", (text, expected) => {
    expect(parse24HourTime(text)).toEqual(expected);
  });

  it.each(["", "24:00", "12:60", "12:30:60", "7 pm", "12"])("rejects %j", (text) => {
    expect(parse24HourTime(text)).toBeNull();
  });
});
