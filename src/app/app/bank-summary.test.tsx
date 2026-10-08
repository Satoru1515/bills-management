import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BankTotal } from "@/lib/domain/breakdown";
import { BankSummary } from "./bank-summary";

const TOTALS: BankTotal[] = [
  {
    bank: "Scotiabank",
    totalDop: 3500,
    count: 3,
    cards: [
      { cardLast4: "5555", totalDop: 2000, count: 2 },
      { cardLast4: "1234", totalDop: 1500, count: 1 },
    ],
  },
  {
    bank: "PayPal",
    totalDop: 630,
    count: 1,
    cards: [{ cardLast4: "7782", totalDop: 630, count: 1 }],
  },
];

describe("BankSummary", () => {
  it("lists each bank with its cards", () => {
    render(<BankSummary totals={TOTALS} category={null} />);

    expect(screen.getByRole("heading", { name: "By bank and card" })).toBeInTheDocument();
    const banks = within(screen.getByRole("region", { name: "By bank and card" }))
      .getAllByRole("listitem")
      .filter((item) => item.parentElement?.parentElement?.tagName === "SECTION");
    expect(banks).toHaveLength(2);
    expect(banks[0]).toHaveTextContent(/^ScotiabankRD\$ 3,500\.00/);

    const cards = within(banks[0]!).getAllByRole("listitem");
    expect(cards.map((card) => card.textContent)).toEqual([
      "Card ending in •••• 5555 · 2 purchasesRD$ 2,000.00",
      "Card ending in •••• 1234 · 1 purchaseRD$ 1,500.00",
    ]);
  });

  it("names the category it is limited to", () => {
    render(<BankSummary totals={[]} category="Compras online" />);
    expect(screen.getByRole("heading")).toHaveTextContent("By bank and card · Compras online");
    expect(screen.getByText("No Compras online purchases this month.")).toBeInTheDocument();
  });

  it("says when there are no purchases", () => {
    render(<BankSummary totals={[]} category={null} />);
    expect(screen.getByText("No purchases this month.")).toBeInTheDocument();
  });
});
