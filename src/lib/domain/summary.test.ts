import { describe, expect, it } from "vitest";
import { summarizeMonth } from "./summary";
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

describe("summarizeMonth", () => {
  it("adds pesos, dollars and the converted total", () => {
    const summary = summarizeMonth(
      [
        tx({ amount: 1500.25 }),
        tx({ amount: 349.9 }),
        tx({ amount: 11.99, currency: "USD", bank: "PayPal" }),
        tx({ amount: 20, currency: "USD" }),
      ],
      { month: "2026-10", usdToDopRate: 63, now: NOW },
    );

    expect(summary).toEqual({
      month: "2026-10",
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
    const summary = summarizeMonth(
      Array.from({ length: 10 }, () => tx({ amount: 0.1 })),
      { month: "2026-10", usdToDopRate: 63, now: NOW },
    );
    expect(summary.dop).toBe(1);
    expect(summary.totalDop).toBe(1);
  });

  it("leaves out ignored transactions and other months", () => {
    const summary = summarizeMonth(
      [
        tx({ amount: 200 }),
        tx({ amount: 999, ignored: true }),
        tx({ amount: 5, currency: "USD", ignored: true }),
        tx({ amount: 400, month: "2026-09", date: "2026-09-30T10:00:00-04:00" }),
      ],
      { month: "2026-10", usdToDopRate: 63, now: NOW },
    );
    expect(summary.totalDop).toBe(200);
    expect(summary.dopCount).toBe(1);
    expect(summary.usdCount).toBe(0);
    expect(summary.ignoredCount).toBe(2);
  });

  it("averages a past month over all its days", () => {
    const summary = summarizeMonth([tx({ amount: 3000, month: "2026-09" })], {
      month: "2026-09",
      usdToDopRate: 63,
      now: NOW,
    });
    expect(summary.days).toBe(30);
    expect(summary.dailyAverage).toBe(100);
  });

  it("is all zeros for an empty month", () => {
    const summary = summarizeMonth([], { month: "2026-10", usdToDopRate: 63, now: NOW });
    expect(summary).toMatchObject({ totalDop: 0, dop: 0, usd: 0, days: 7, dailyAverage: 0 });
  });

  it("has no daily average before the month starts", () => {
    const summary = summarizeMonth([], { month: "2026-11", usdToDopRate: 63, now: NOW });
    expect(summary.days).toBe(0);
    expect(summary.dailyAverage).toBeNull();
  });
});
