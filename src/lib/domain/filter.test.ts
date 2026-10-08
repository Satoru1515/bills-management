import { describe, expect, it } from "vitest";
import { banksIn, filterTransactions, searchTerms, totalDop } from "./filter";
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

const BRAVO = tx({ amount: 1500.5 });
const CAFE = tx({
  merchant: "Café Santo Domingo",
  category: "Restaurantes",
  bank: "APAP",
  cardLast4: "9876",
});
const NETFLIX = tx({
  merchant: "NETFLIX.COM",
  category: "Suscripciones",
  bank: "PayPal",
  cardLast4: "7782",
  amount: 11.99,
  currency: "USD",
});
const SHELL = tx({
  merchant: "SHELL NAVARRETE",
  category: "Combustible",
  ignored: true,
  amount: 2000,
});
const MONTH = [BRAVO, CAFE, NETFLIX, SHELL];

describe("searchTerms", () => {
  it("normalizes case, accents and spaces", () => {
    expect(searchTerms("  café   bravo ")).toEqual(["CAFE", "BRAVO"]);
    expect(searchTerms("   ")).toEqual([]);
  });
});

describe("filterTransactions", () => {
  it("returns everything, in order, without filters", () => {
    expect(filterTransactions(MONTH, {})).toEqual(MONTH);
    expect(filterTransactions(MONTH, { search: " ", bank: null, category: null })).toEqual(MONTH);
  });

  it("searches the merchant ignoring case and accents", () => {
    expect(filterTransactions(MONTH, { search: "cafe" })).toEqual([CAFE]);
    expect(filterTransactions(MONTH, { search: "CAFÉ santo" })).toEqual([CAFE]);
    expect(filterTransactions(MONTH, { search: "netflix.com" })).toEqual([NETFLIX]);
  });

  it("needs every word to match somewhere", () => {
    expect(filterTransactions(MONTH, { search: "bravo supermercado" })).toEqual([BRAVO]);
    expect(filterTransactions(MONTH, { search: "bravo apap" })).toEqual([]);
  });

  it("matches the category, bank, card digits and amount", () => {
    expect(filterTransactions(MONTH, { search: "restaurantes" })).toEqual([CAFE]);
    expect(filterTransactions(MONTH, { search: "paypal" })).toEqual([NETFLIX]);
    expect(filterTransactions(MONTH, { search: "9876" })).toEqual([CAFE]);
    expect(filterTransactions(MONTH, { search: "1500.50" })).toEqual([BRAVO]);
    expect(filterTransactions(MONTH, { search: "11.99" })).toEqual([NETFLIX]);
  });

  it("keeps ignored transactions in the results", () => {
    expect(filterTransactions(MONTH, { search: "shell" })).toEqual([SHELL]);
  });

  it("filters by bank and category, combined with the search", () => {
    expect(filterTransactions(MONTH, { bank: "Scotiabank" })).toEqual([BRAVO, SHELL]);
    expect(filterTransactions(MONTH, { category: "Suscripciones" })).toEqual([NETFLIX]);
    expect(filterTransactions(MONTH, { bank: "Scotiabank", category: "Combustible" })).toEqual([
      SHELL,
    ]);
    expect(filterTransactions(MONTH, { bank: "Scotiabank", search: "bravo" })).toEqual([BRAVO]);
    expect(filterTransactions(MONTH, { bank: "APAP", category: "Supermercado" })).toEqual([]);
  });
});

describe("banksIn", () => {
  it("lists the banks present, in the usual order", () => {
    expect(banksIn([NETFLIX, CAFE, BRAVO, SHELL])).toEqual(["Scotiabank", "APAP", "PayPal"]);
    expect(banksIn([])).toEqual([]);
  });
});

describe("totalDop", () => {
  it("adds pesos and converted dollars, leaving ignored ones out", () => {
    // 1500.50 + 100 + 11.99 × 63 (755.37); the ignored 2000 is left out.
    expect(totalDop(MONTH, 63)).toBe(2355.87);
    expect(totalDop([SHELL], 63)).toBe(0);
    expect(totalDop([], 63)).toBe(0);
  });
});
