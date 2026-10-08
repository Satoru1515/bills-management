import { describe, expect, it } from "vitest";
import { DEFAULT_USD_TO_DOP_RATE } from "@/lib/domain/money";
import type { TransactionRow } from "@/lib/repo/transactions";
import { argsOf, createSupabaseMock } from "@/test/supabase-mock";
import { loadDashboard } from "./load";
import { dashboardHref } from "./url";

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
      { data: [row({ amount: 1000 }), row({ amount: 10, currency: "USD" })] },
      { data: [row({ amount: 1100, month: "2026-09", date: "2026-09-20T15:00:00+00:00" })] },
      { data: { usd_to_dop_rate: 60 } },
    );

    const data = await loadDashboard(mock.client, USER, "2026-10", NOW);

    expect(mock.queries.map((q) => q.table)).toEqual(["transactions", "transactions", "profiles"]);
    expect(argsOf(mock.queries[0], "eq")).toContainEqual(["month", "2026-10"]);
    expect(argsOf(mock.queries[1], "eq")).toContainEqual(["month", "2026-09"]);
    expect(data.month).toBe("2026-10");
    expect(data.maxMonth).toBe("2026-10");
    expect(data.usdToDopRate).toBe(60);
    expect(data.defaultRate).toBe(false);
    expect(data.current).toMatchObject({ totalDop: 1600, dop: 1000, usd: 10, days: 7 });
    expect(data.previous).toMatchObject({ month: "2026-09", totalDop: 1100, days: 30 });
    expect(data.change).toBeCloseTo(500 / 1100);
    expect(data.transactions).toHaveLength(2);
    expect(data.transactions[0]!.date).toBe("2026-10-04T20:07:00-04:00");
  });

  it("uses the default rate and has no change without a previous month", async () => {
    const mock = createSupabaseMock();
    mock.respond(
      { data: [row({ amount: 10, currency: "USD" })] },
      { data: [] },
      { data: { usd_to_dop_rate: null } },
    );

    const data = await loadDashboard(mock.client, USER, "2026-10", NOW);

    expect(data.usdToDopRate).toBe(DEFAULT_USD_TO_DOP_RATE);
    expect(data.defaultRate).toBe(true);
    expect(data.current.totalDop).toBe(10 * DEFAULT_USD_TO_DOP_RATE);
    expect(data.change).toBeNull();
  });

  it("compares January with December of the year before", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: [] }, { data: [] }, { data: null });
    const data = await loadDashboard(mock.client, USER, "2026-01", NOW);
    expect(argsOf(mock.queries[1], "eq")).toContainEqual(["month", "2025-12"]);
    expect(data.previous.month).toBe("2025-12");
  });

  it("fails when a query fails", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "boom" } }, { data: [] }, { data: null });
    await expect(loadDashboard(mock.client, USER, "2026-10", NOW)).rejects.toThrow(
      "listByMonth: boom",
    );
  });
});

describe("dashboardHref", () => {
  it("puts the month in the query", () => {
    expect(dashboardHref("2026-09")).toBe("/app?month=2026-09");
  });
});
