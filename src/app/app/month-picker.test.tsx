import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { MonthPicker } from "./month-picker";

beforeEach(() => {
  push.mockReset();
});

describe("MonthPicker", () => {
  it("links to the previous and next months", () => {
    render(<MonthPicker month="2026-08" maxMonth="2026-10" />);

    expect(screen.getByRole("link", { name: "Previous month, July 2026" })).toHaveAttribute(
      "href",
      "/app?month=2026-07",
    );
    expect(screen.getByRole("link", { name: "Next month, September 2026" })).toHaveAttribute(
      "href",
      "/app?month=2026-09",
    );
    expect(screen.getByLabelText("Month to show")).toHaveValue("2026-08");
  });

  it("has no next link on the latest month", () => {
    render(<MonthPicker month="2026-10" maxMonth="2026-10" />);
    expect(screen.queryByRole("link", { name: /Next month/ })).toBeNull();
    expect(screen.getByLabelText("Month to show")).toHaveAttribute("max", "2026-10");
  });

  it("navigates when a month is picked", () => {
    render(<MonthPicker month="2026-10" maxMonth="2026-10" />);
    fireEvent.change(screen.getByLabelText("Month to show"), { target: { value: "2025-12" } });
    expect(push).toHaveBeenCalledWith("/app?month=2025-12");
  });

  it("keeps the category filter", () => {
    render(<MonthPicker month="2026-08" maxMonth="2026-10" category="Supermercado" />);
    expect(screen.getByRole("link", { name: /Previous month/ })).toHaveAttribute(
      "href",
      "/app?month=2026-07&category=Supermercado",
    );
    expect(screen.getByRole("link", { name: /Next month/ })).toHaveAttribute(
      "href",
      "/app?month=2026-09&category=Supermercado",
    );
    fireEvent.change(screen.getByLabelText("Month to show"), { target: { value: "2026-01" } });
    expect(push).toHaveBeenCalledWith("/app?month=2026-01&category=Supermercado");
  });

  it("ignores cleared, future or unchanged values", () => {
    render(<MonthPicker month="2026-09" maxMonth="2026-10" />);
    const input = screen.getByLabelText("Month to show");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "2026-11" } });
    expect(push).not.toHaveBeenCalled();
  });
});
