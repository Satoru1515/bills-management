import { describe, expect, it } from "vitest";
import { DEFAULT_USD_TO_DOP_RATE } from "@/lib/domain/money";
import { monthPeriod, rangePeriod } from "@/lib/domain/period";
import type { TransactionRow } from "@/lib/repo/transactions";
import { argsOf, createSupabaseMock } from "@/test/supabase-mock";
import { loadDashboard } from "./load";

const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-07T19:00:00Z");

let nextId = 0;
function row(overrides: Partial<TransactionRow>): TransactionRow {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    user_id: USER,
    gmail_message_id: `msg-${nextId}`,
    date: "2026-10-05T00:07:00+00:00",
    month: "2026-10",
    bank: "Scotiabank",
    card_last4: "1234",
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

describe("loadDashboard", () => {
  it("summarizes the month against the previous one with the user's rate", async () => {
    const mock = createSupabaseMock();
    mock.respond(
      {
        data: [
          row({ amount: 1000 }),
          row({ amount: 10, currency: "USD" }),
          row({ amount: 1100, month: "2026-09", date: "2026-09-20T15:00:00+00:00" }),
          row({ amount: 700, month: "2026-05", date: "2026-05-02T15:00:00+00:00" }),
        ],
      },
      { data: { usd_to_dop_rate: 60 } },
    );

    const data = await loadDashboard(mock.client, USER, monthPeriod("2026-10"), NOW);

    expect(mock.queries.map((q) => q.table)).toEqual(["transactions", "profiles"]);
    // Six trend months (May to October) plus the April before them.
    expect(argsOf(mock.queries[0], "gte")).toEqual([["date", "2026-04-01T00:00:00-04:00"]]);
    expect(argsOf(mock.queries[0], "lt")).toEqual([["date", "2026-11-01T00:00:00-04:00"]]);
    expect(data.period).toEqual(monthPeriod("2026-10"));
    expect(data.maxMonth).toBe("2026-10");
    expect(data.today).toBe("2026-10-07");
    expect(data.usdToDopRate).toBe(60);
    expect(data.defaultRate).toBe(false);
    expect(data.current).toMatchObject({ totalDop: 1600, dop: 1000, usd: 10, days: 7 });
    expect(data.previous).toMatchObject({
      period: monthPeriod("2026-09"),
      totalDop: 1100,
      days: 30,
    });
    expect(data.change).toBeCloseTo(500 / 1100);
    expect(data.transactions).toHaveLength(2);
    expect(data.transactions[0]!.date).toBe("2026-10-04T20:07:00-04:00");
    expect(data.previousTransactions).toHaveLength(1);
    expect(data.trend.map((m) => [m.month, m.totalDop])).toEqual([
      ["2026-05", 700],
      ["2026-06", 0],
      ["2026-07", 0],
      ["2026-08", 0],
      ["2026-09", 1100],
      ["2026-10", 1600],
    ]);
    expect(data.trend.at(-1)!.change).toBeCloseTo(500 / 1100);
  });

  it("uses the default rate and has no change without a previous month", async () => {
    const mock = createSupabaseMock();
    mock.respond(
      { data: [row({ amount: 10, currency: "USD" })] },
      { data: { usd_to_dop_rate: null } },
    );

    const data = await loadDashboard(mock.client, USER, monthPeriod("2026-10"), NOW);

    expect(data.usdToDopRate).toBe(DEFAULT_USD_TO_DOP_RATE);
    expect(data.defaultRate).toBe(true);
    expect(data.current.totalDop).toBe(10 * DEFAULT_USD_TO_DOP_RATE);
    expect(data.change).toBeNull();
  });

  it("compares a custom range with as many days right before it", async () => {
    const mock = createSupabaseMock();
    mock.respond(
      {
        data: [
          row({ amount: 300 }),
          row({ amount: 200, month: "2026-09", date: "2026-09-20T15:00:00+00:00" }),
          row({ amount: 400, month: "2026-07", date: "2026-07-20T15:00:00+00:00" }),
        ],
      },
      { data: null },
    );

    const period = rangePeriod("2026-09-01", "2026-10-07");
    const data = await loadDashboard(mock.client, USER, period, NOW);

    // The previous 37 days start on 2026-07-26, after the trend's April start.
    expect(argsOf(mock.queries[0], "gte")).toEqual([["date", "2026-04-01T00:00:00-04:00"]]);
    expect(argsOf(mock.queries[0], "lt")).toEqual([["date", "2026-10-08T00:00:00-04:00"]]);
    expect(data.current).toMatchObject({ totalDop: 500, days: 37 });
    expect(data.previous.period).toEqual(rangePeriod("2026-07-26", "2026-08-31"));
    expect(data.previous.totalDop).toBe(0);
    expect(data.change).toBeNull();
  });

  it("reads further back when the previous range starts before the trend", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: [] }, { data: null });
    await loadDashboard(mock.client, USER, rangePeriod("2025-10-08", "2026-10-07"), NOW);
    expect(argsOf(mock.queries[0], "gte")).toEqual([["date", "2024-10-08T00:00:00-04:00"]]);
  });

  it("fails when a query fails", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "boom" } }, { data: null });
    await expect(loadDashboard(mock.client, USER, monthPeriod("2026-10"), NOW)).rejects.toThrow(
      "listBetween: boom",
    );
  });
});
