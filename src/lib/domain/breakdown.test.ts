import { describe, expect, it } from "vitest";
import { totalsByBank, totalsByCategory } from "./breakdown";
import type { Transaction } from "./types";

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

const MONTH = [
  tx({ amount: 1500, category: "Supermercado" }),
  tx({ amount: 500.5, category: "Supermercado", bank: "APAP", cardLast4: "9876" }),
  tx({ amount: 10, currency: "USD", category: "Suscripciones", bank: "PayPal", cardLast4: "7782" }),
  tx({ amount: 2000, category: "Combustible", cardLast4: "5555" }),
  tx({ amount: 9999, category: "Viajes", ignored: true }),
];

describe("totalsByCategory", () => {
  it("adds each category in pesos, largest first, with its share", () => {
    expect(totalsByCategory(MONTH, 63)).toEqual([
      { category: "Supermercado", totalDop: 2000.5, count: 2, share: 200050 / 463050 },
      { category: "Combustible", totalDop: 2000, count: 1, share: 200000 / 463050 },
      { category: "Suscripciones", totalDop: 630, count: 1, share: 63000 / 463050 },
    ]);
  });

  it("keeps the category order on ties and skips ignored transactions", () => {
    const totals = totalsByCategory(
      [
        tx({ amount: 100, category: "Otros" }),
        tx({ amount: 100, category: "Restaurantes" }),
        tx({ amount: 500, category: "Salud", ignored: true }),
      ],
      63,
    );
    expect(totals.map((t) => t.category)).toEqual(["Restaurantes", "Otros"]);
    expect(totals.map((t) => t.share)).toEqual([0.5, 0.5]);
  });

  it("is empty without purchases", () => {
    expect(totalsByCategory([], 63)).toEqual([]);
    expect(totalsByCategory([tx({ ignored: true })], 63)).toEqual([]);
  });
});

describe("totalsByBank", () => {
  it("adds each bank and its cards, largest first", () => {
    expect(totalsByBank(MONTH, 63)).toEqual([
      {
        bank: "Scotiabank",
        totalDop: 3500,
        count: 2,
        cards: [
          { cardLast4: "5555", totalDop: 2000, count: 1 },
          { cardLast4: "1234", totalDop: 1500, count: 1 },
        ],
      },
      {
        bank: "PayPal",
        totalDop: 630,
        count: 1,
        cards: [{ cardLast4: "7782", totalDop: 630, count: 1 }],
      },
      {
        bank: "APAP",
        totalDop: 500.5,
        count: 1,
        cards: [{ cardLast4: "9876", totalDop: 500.5, count: 1 }],
      },
    ]);
  });

  it("limits the totals to one category", () => {
    expect(totalsByBank(MONTH, 63, "Supermercado")).toEqual([
      {
        bank: "Scotiabank",
        totalDop: 1500,
        count: 1,
        cards: [{ cardLast4: "1234", totalDop: 1500, count: 1 }],
      },
      {
        bank: "APAP",
        totalDop: 500.5,
        count: 1,
        cards: [{ cardLast4: "9876", totalDop: 500.5, count: 1 }],
      },
    ]);
    expect(totalsByBank(MONTH, 63, "Viajes")).toEqual([]);
  });

  it("orders ties by bank and card", () => {
    const totals = totalsByBank(
      [
        tx({ bank: "PayPal", cardLast4: "2222" }),
        tx({ bank: "Banco Santa Cruz", cardLast4: "3333" }),
        tx({ bank: "Banco Santa Cruz", cardLast4: "1111" }),
        tx({ bank: "Scotiabank", cardLast4: "4444", amount: 200 }),
      ],
      63,
    );
    expect(totals.map((t) => t.bank)).toEqual(["Scotiabank", "Banco Santa Cruz", "PayPal"]);
    expect(totals[1]!.cards.map((c) => c.cardLast4)).toEqual(["1111", "3333"]);
  });
});
