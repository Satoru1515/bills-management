import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { monthPeriod, presetPeriods, rangePeriod } from "@/lib/domain/period";
import { RangePicker } from "./range-picker";

const NOW = new Date("2026-10-07T19:00:00Z");
const PRESETS = presetPeriods(NOW);

beforeEach(() => {
  push.mockReset();
});

describe("RangePicker", () => {
  it("is collapsed under Advanced filters until opened", () => {
    const { container } = render(
      <RangePicker
        period={rangePeriod("2026-08-01", "2026-10-07")}
        presets={PRESETS}
        today="2026-10-07"
      />,
    );
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")).toHaveTextContent("Advanced filters · custom range");
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(true);
  });

  it("links to the quick ranges and marks the one on screen", () => {
    render(<RangePicker period={monthPeriod("2026-10")} presets={PRESETS} today="2026-10-07" />);

    expect(screen.getByRole("link", { name: "This month" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: "Last 6 months" })).toHaveAttribute(
      "href",
      "/app?from=2026-05-01&to=2026-10-07",
    );
    expect(screen.getByRole("link", { name: "This year" })).toHaveAttribute(
      "href",
      "/app?from=2026-01-01&to=2026-10-07",
    );
  });

  it("starts the custom range on the period and caps it at today", () => {
    render(<RangePicker period={monthPeriod("2026-10")} presets={PRESETS} today="2026-10-07" />);
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-10-07");
    expect(screen.getByLabelText("To")).toHaveAttribute("max", "2026-10-07");
  });

  it("navigates to a custom range, keeping the category", () => {
    render(
      <RangePicker
        period={rangePeriod("2026-08-01", "2026-10-07")}
        presets={PRESETS}
        today="2026-10-07"
        category="Supermercado"
      />,
    );
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-15" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Show range" }));
    expect(push).toHaveBeenCalledWith("/app?from=2026-03-15&to=2026-06-30&category=Supermercado");
  });

  it("does not apply a reversed range", () => {
    render(<RangePicker period={monthPeriod("2026-10")} presets={PRESETS} today="2026-10-07" />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });
    expect(screen.getByRole("button", { name: "Show range" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Custom range" }));
    expect(push).not.toHaveBeenCalled();
  });
});
