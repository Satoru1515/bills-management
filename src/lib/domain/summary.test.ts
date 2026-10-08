import { describe, expect, it } from "vitest";
import { monthPeriod, rangePeriod } from "./period";
import { monthlyTrend, summarizePeriod } from "./summary";
import type { Transaction } from "./types";

const NOW = new Date("2026-10-07T19:00:00Z");

let nextId = 0;
function tx(overrides: Partial<Transaction>): Transaction {
  nextId += 1;
  return {
    id: `tx-${nextId}`,
    userId: "user-1",
    gmailMessageId: `msg-${nextId}`,
    date: "2026-10-04T20:07:00-04:00",
    month: "2026-10",
    bank: "Scotiabank",
    cardLast4: "1234",
    amount: 100,
    currency: "DOP",
    merchant: "SUPERMERCADO BRAVO",
    kind: "consumo",
    category: "Supermercado",
    ignored: false,
    source: "gmail",
    ...overrides,
  };
}

describe("summarizePeriod", () => {
  it("adds pesos, dollars and the converted total", () => {
    const summary = summarizePeriod(
      [
        tx({ amount: 1500.25 }),
        tx({ amount: 349.9 }),
        tx({ amount: 11.99, currency: "USD", bank: "PayPal" }),
        tx({ amount: 20, currency: "USD" }),
      ],
      { period: monthPeriod("2026-10"), usdToDopRate: 63, now: NOW },
    );

    expect(summary).toEqual({
      period: monthPeriod("2026-10"),
      dop: 1850.15,
      usd: 31.99,
      // 1850.15 + 755.37 + 1260.00
      totalDop: 3865.52,
      dopCount: 2,
      usdCount: 2,
      ignoredCount: 0,
      days: 7,
      dailyAverage: 552.22,
    });
  });

  it("does not drift when adding many cents", () => {
    const summary = summarizePeriod(
      Array.from({ length: 10 }, () => tx({ amount: 0.1 })),
      { period: monthPeriod("2026-10"), usdToDopRate: 63, now: NOW },
    );
    expect(summary.dop).toBe(1);
    expect(summary.totalDop).toBe(1);
  });

  it("leaves out ignored transactions and other months", () => {
    const summary = summarizePeriod(
      [
        tx({ amount: 200 }),
        tx({ amount: 999, ignored: true }),
        tx({ amount: 5, currency: "USD", ignored: true }),
        tx({ amount: 400, month: "2026-09", date: "2026-09-30T10:00:00-04:00" }),
      ],
      { period: monthPeriod("2026-10"), usdToDopRate: 63, now: NOW },
    );
    expect(summary.totalDop).toBe(200);
    expect(summary.dopCount).toBe(1);
    expect(summary.usdCount).toBe(0);
    expect(summary.ignoredCount).toBe(2);
  });

  it("averages a past month over all its days", () => {
    const summary = summarizePeriod(
      [tx({ amount: 3000, month: "2026-09", date: "2026-09-12T10:00:00-04:00" })],
      {
        period: monthPeriod("2026-09"),
        usdToDopRate: 63,
        now: NOW,
      },
    );
    expect(summary.days).toBe(30);
    expect(summary.dailyAverage).toBe(100);
  });

  it("is all zeros for an empty month", () => {
    const summary = summarizePeriod([], {
      period: monthPeriod("2026-10"),
      usdToDopRate: 63,
      now: NOW,
    });
    expect(summary).toMatchObject({ totalDop: 0, dop: 0, usd: 0, days: 7, dailyAverage: 0 });
  });

  it("has no daily average before the month starts", () => {
    const summary = summarizePeriod([], {
      period: monthPeriod("2026-11"),
      usdToDopRate: 63,
      now: NOW,
    });
    expect(summary.days).toBe(0);
    expect(summary.dailyAverage).toBeNull();
  });

  it("sums a custom range of days, averaging over the days elapsed so far", () => {
    const summary = summarizePeriod(
      [
        tx({ amount: 100, month: "2026-08", date: "2026-08-31T23:59:00-04:00" }),
        tx({ amount: 200, month: "2026-09", date: "2026-09-01T00:00:00-04:00" }),
        tx({ amount: 300 }),
      ],
      { period: rangePeriod("2026-09-01", "2026-10-31"), usdToDopRate: 63, now: NOW },
    );
    expect(summary.totalDop).toBe(500);
    // 30 days of September + 7 of October
    expect(summary.days).toBe(37);
  });
});

describe("monthlyTrend", () => {
  it("totals each month and compares it with the month before", () => {
    const trend = monthlyTrend(
      [
        tx({ amount: 1000, month: "2026-07" }),
        tx({ amount: 500, month: "2026-08" }),
        tx({ amount: 10, currency: "USD", month: "2026-08" }),
        tx({ amount: 999, month: "2026-08", ignored: true }),
        tx({ amount: 900, month: "2026-10" }),
      ],
      ["2026-08", "2026-09", "2026-10"],
      50,
    );
    expect(trend).toEqual([
      { month: "2026-08", totalDop: 1000, count: 2, change: 0 },
      { month: "2026-09", totalDop: 0, count: 0, change: -1 },
      { month: "2026-10", totalDop: 900, count: 1, change: null },
    ]);
  });
});
