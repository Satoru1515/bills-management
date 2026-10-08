import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CategoryTotal } from "@/lib/domain/breakdown";
import { monthPeriod, rangePeriod } from "@/lib/domain/period";
import type { Category } from "@/lib/domain/types";
import { CategoryBars } from "./category-bars";

const TOTALS: CategoryTotal[] = [
  { category: "Supermercado", totalDop: 2000, count: 2, share: 0.5 },
  { category: "Compras online", totalDop: 1500, count: 1, share: 0.375 },
  { category: "Otros", totalDop: 500, count: 3, share: 0.125 },
];

const OCTOBER = monthPeriod("2026-10");

describe("CategoryBars", () => {
  it("shows a bar per category that links to the filtered page", () => {
    render(<CategoryBars period={OCTOBER} totals={TOTALS} selected={null} />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Supermercado: RD$ 2,000.00, 2 purchases",
      "Compras online: RD$ 1,500.00, 1 purchase",
      "Otros: RD$ 500.00, 3 purchases",
    ]);
    expect(links[1]).toHaveAttribute("href", "/app?month=2026-10&category=Compras+online");
    expect(links[0]).toHaveTextContent("50%");
    expect(screen.queryByText("Show all categories")).toBeNull();

    const bars = links.map((link) => link.querySelector<HTMLElement>("[aria-hidden] > span"));
    expect(bars.map((bar) => bar?.style.width)).toEqual(["100%", "75%", "25%"]);
  });

  it("marks the selected category and links back to all of them", () => {
    render(<CategoryBars period={OCTOBER} totals={TOTALS} selected="Supermercado" />);

    const selected = screen.getByRole("link", { name: /^Supermercado:/ });
    expect(selected).toHaveAttribute("aria-current", "true");
    expect(selected).toHaveAttribute("href", "/app?month=2026-10");
    expect(screen.getByRole("link", { name: /^Otros:/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Show all categories" })).toHaveAttribute(
      "href",
      "/app?month=2026-10",
    );
  });

  it("says when there are no purchases", () => {
    render(<CategoryBars period={OCTOBER} totals={[]} selected={null} />);
    expect(screen.getByText("No purchases this month.")).toBeInTheDocument();
  });

  it("shows each category's change against the previous period", () => {
    const previous = new Map<Category, number>([
      ["Supermercado", 2500],
      ["Compras online", 1000],
    ]);
    render(<CategoryBars period={OCTOBER} totals={TOTALS} selected={null} previous={previous} />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Supermercado: RD$ 2,000.00, 2 purchases, −20.0% vs before",
      "Compras online: RD$ 1,500.00, 1 purchase, +50.0% vs before",
      "Otros: RD$ 500.00, 3 purchases, new",
    ]);
    expect(within(links[0]!).getByTitle("less spending")).toHaveClass("text-emerald-600");
    expect(within(links[1]!).getByTitle("more spending")).toHaveClass("text-red-600");
    expect(links[2]).toHaveTextContent("new");
  });

  it("speaks of a custom range as a period", () => {
    render(
      <CategoryBars period={rangePeriod("2026-04-01", "2026-10-07")} totals={[]} selected={null} />,
    );
    expect(screen.getByText("No purchases in this period.")).toBeInTheDocument();
  });
});
