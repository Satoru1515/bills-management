import { describe, expect, it } from "vitest";
import { currentDay, dayOf, daysInclusive, formatDay, isDay, shiftDay } from "./day";

describe("isDay", () => {
  it("accepts real calendar days only", () => {
    expect(isDay("2026-10-04")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("2026-1-01")).toBe(false);
    expect(isDay("")).toBe(false);
  });
});

describe("currentDay", () => {
  it("uses Dominican Republic time", () => {
    expect(currentDay(new Date("2026-10-08T03:59:00Z"))).toBe("2026-10-07");
    expect(currentDay(new Date("2026-10-08T04:00:00Z"))).toBe("2026-10-08");
  });
});

describe("shiftDay", () => {
  it("moves across months and years", () => {
    expect(shiftDay("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("rejects malformed days", () => {
    expect(() => shiftDay("2026-02-30", 1)).toThrow(RangeError);
  });
});

describe("daysInclusive", () => {
  it("counts both ends", () => {
    expect(daysInclusive("2026-10-01", "2026-10-31")).toBe(31);
    expect(daysInclusive("2026-10-08", "2026-10-08")).toBe(1);
    expect(daysInclusive("2026-10-09", "2026-10-08")).toBe(0);
  });
});

describe("dayOf", () => {
  it("returns the DR day of a timestamp", () => {
    expect(dayOf("2026-10-04T23:30:00-04:00")).toBe("2026-10-04");
    expect(dayOf("2026-10-05T02:00:00Z")).toBe("2026-10-04");
    expect(dayOf("nope")).toBeNull();
  });
});

describe("formatDay", () => {
  it("formats a short label", () => {
    expect(formatDay("2026-10-04")).toBe("Oct 4, 2026");
  });
});
