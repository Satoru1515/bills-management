import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CategoryTotal } from "@/lib/domain/breakdown";
import { CategoryBars } from "./category-bars";

const TOTALS: CategoryTotal[] = [
  { category: "Supermercado", totalDop: 2000, count: 2, share: 0.5 },
  { category: "Compras online", totalDop: 1500, count: 1, share: 0.375 },
  { category: "Otros", totalDop: 500, count: 3, share: 0.125 },
];

describe("CategoryBars", () => {
  it("shows a bar per category that links to the filtered page", () => {
    render(<CategoryBars month="2026-10" totals={TOTALS} selected={null} />);

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
    render(<CategoryBars month="2026-10" totals={TOTALS} selected="Supermercado" />);

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
    render(<CategoryBars month="2026-10" totals={[]} selected={null} />);
    expect(screen.getByText("No purchases this month.")).toBeInTheDocument();
  });
});
