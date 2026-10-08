import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveRateAction, lookupRateAction } = vi.hoisted(() => ({
  saveRateAction: vi.fn(),
  lookupRateAction: vi.fn(),
}));
vi.mock("./actions", () => ({ saveRateAction, lookupRateAction }));

import { RateForm } from "./rate-form";

beforeEach(() => {
  saveRateAction.mockReset();
  lookupRateAction.mockReset();
});

describe("RateForm", () => {
  it("shows the saved rate", () => {
    render(<RateForm rate={62.85} today="2026-10-08" />);
    expect(screen.getByLabelText("Pesos per US dollar")).toHaveValue("62.85");
    expect(screen.getByText(/Saved rate: 62\.85\./)).toBeInTheDocument();
  });

  it("shows the default when no rate is saved", () => {
    render(<RateForm rate={null} today="2026-10-08" />);
    const input = screen.getByLabelText("Pesos per US dollar");
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "63.00");
    expect(screen.getByText(/Using the default rate of 63\.00\./)).toBeInTheDocument();
  });

  it("submits the typed rate and shows the result", async () => {
    saveRateAction.mockResolvedValue({
      status: "saved",
      message: "Saved. Dollar purchases now count at 61.50 pesos.",
    });
    render(<RateForm rate={null} today="2026-10-08" />);

    fireEvent.change(screen.getByLabelText("Pesos per US dollar"), { target: { value: "61,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Saved. Dollar purchases now count at 61.50 pesos."),
    ).toBeInTheDocument();
    expect(saveRateAction).toHaveBeenCalledTimes(1);
    const [previous, formData] = saveRateAction.mock.calls[0] as [unknown, FormData];
    expect(previous).toEqual({ status: "idle", message: "" });
    expect(formData.get("rate")).toBe("61,5");
  });

  it("keeps a rejected value in the box", async () => {
    saveRateAction.mockResolvedValue({
      status: "error",
      message: "Enter a rate between 1 and 1000 pesos per dollar.",
    });
    render(<RateForm rate={63} today="2026-10-08" />);

    fireEvent.change(screen.getByLabelText("Pesos per US dollar"), { target: { value: "6300" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Enter a rate between 1 and 1000 pesos per dollar."),
    ).toHaveAttribute("role", "status");
    expect(screen.getByLabelText("Pesos per US dollar")).toHaveValue("6300");
  });

  it("fills the box with the rate published on the chosen day", async () => {
    lookupRateAction.mockResolvedValue({
      ok: true,
      date: "2026-09-15",
      rate: 58.9582,
      message: "Rate on Sep 15, 2026: 58.9582. Press Save to use it.",
    });
    render(<RateForm rate={63} today="2026-10-08" />);

    const day = screen.getByLabelText("Rate published on");
    expect(day).toHaveValue("2026-10-08");
    expect(day).toHaveAttribute("max", "2026-10-08");
    fireEvent.change(day, { target: { value: "2026-09-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Get rate" }));

    expect(
      await screen.findByText("Rate on Sep 15, 2026: 58.9582. Press Save to use it."),
    ).toBeInTheDocument();
    expect(lookupRateAction).toHaveBeenCalledWith("2026-09-15");
    expect(screen.getByLabelText("Pesos per US dollar")).toHaveValue("58.9582");
    expect(saveRateAction).not.toHaveBeenCalled();
  });

  it("keeps the typed rate when the lookup fails", async () => {
    lookupRateAction.mockResolvedValue({
      ok: false,
      message: "Could not get the rate for that day. Try again later or type it in.",
    });
    render(<RateForm rate={63} today="2026-10-08" />);
    fireEvent.click(screen.getByRole("button", { name: "Get rate" }));

    expect(
      await screen.findByText(
        "Could not get the rate for that day. Try again later or type it in.",
      ),
    ).toHaveClass("text-red-600");
    expect(screen.getByLabelText("Pesos per US dollar")).toHaveValue("63");
  });
});
