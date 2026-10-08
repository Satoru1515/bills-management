import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveRateAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ saveRateAction }));

import { RateForm } from "./rate-form";

beforeEach(() => {
  saveRateAction.mockReset();
});

describe("RateForm", () => {
  it("shows the saved rate", () => {
    render(<RateForm rate={62.85} />);
    expect(screen.getByLabelText("Pesos per US dollar")).toHaveValue("62.85");
    expect(screen.getByText(/Saved rate: 62\.85\./)).toBeInTheDocument();
  });

  it("shows the default when no rate is saved", () => {
    render(<RateForm rate={null} />);
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
    render(<RateForm rate={null} />);

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
    render(<RateForm rate={63} />);

    fireEvent.change(screen.getByLabelText("Pesos per US dollar"), { target: { value: "6300" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Enter a rate between 1 and 1000 pesos per dollar.",
    );
    expect(screen.getByLabelText("Pesos per US dollar")).toHaveValue("6300");
  });
});
