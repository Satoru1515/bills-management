import { describe, expect, it } from "vitest";
import {
  DEFAULT_USD_TO_DOP_RATE,
  formatChange,
  formatMoney,
  formatRate,
  relativeChange,
  toDop,
} from "./money";

describe("toDop", () => {
  it("keeps pesos and converts dollars, rounded to cents", () => {
    expect(toDop(1500.25, "DOP", 63)).toBe(1500.25);
    expect(toDop(11.99, "USD", 63)).toBe(755.37);
    expect(toDop(0.1, "USD", 62.3456)).toBe(6.23);
  });

  it("has a positive default rate", () => {
    expect(DEFAULT_USD_TO_DOP_RATE).toBeGreaterThan(0);
  });
});

describe("formatMoney", () => {
  it("prefixes the currency symbol and groups thousands", () => {
    expect(formatMoney(1234.5, "DOP")).toBe("RD$ 1,234.50");
    expect(formatMoney(0, "DOP")).toBe("RD$ 0.00");
    expect(formatMoney(11.99, "USD")).toBe("US$ 11.99");
    expect(formatMoney(1234567.891, "USD")).toBe("US$ 1,234,567.89");
    expect(formatMoney(-5, "DOP")).toBe("-RD$ 5.00");
  });
});

describe("formatRate", () => {
  it("shows at least 2 and at most 4 decimals", () => {
    expect(formatRate(63)).toBe("63.00");
    expect(formatRate(62.1234)).toBe("62.1234");
    expect(formatRate(1234.5)).toBe("1,234.50");
  });
});

describe("relativeChange", () => {
  it("is a fraction of the previous value", () => {
    expect(relativeChange(150, 100)).toBe(0.5);
    expect(relativeChange(75, 100)).toBe(-0.25);
    expect(relativeChange(0, 100)).toBe(-1);
  });

  it("is null without a previous value", () => {
    expect(relativeChange(100, 0)).toBeNull();
    expect(relativeChange(0, 0)).toBeNull();
  });
});

describe("formatChange", () => {
  it("shows a signed percentage with one decimal", () => {
    expect(formatChange(0.1234)).toBe("+12.3%");
    expect(formatChange(-0.05)).toBe("−5.0%");
    expect(formatChange(0)).toBe("0.0%");
    expect(formatChange(0.00001)).toBe("0.0%");
    expect(formatChange(12.5)).toBe("+1,250.0%");
  });
});
