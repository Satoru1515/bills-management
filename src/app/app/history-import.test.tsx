import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { HistoryImport } from "./history-import";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const OK_BODY = {
  status: "ok",
  finishedAt: "2026-10-07T16:00:04.000Z",
  messagesSeen: 40,
  newTransactions: 25,
  unparsed: 0,
  duplicates: 3,
  errorCount: 0,
  reconnectRequired: false,
};

describe("HistoryImport", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    refresh.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderImport() {
    render(<HistoryImport defaultSince="2026-04-01" minSince="2024-10-09" maxSince="2026-10-07" />);
  }

  it("posts the chosen day to /api/sync and refreshes the page", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, OK_BODY));
    renderImport();

    const input = screen.getByLabelText("Import emails since");
    expect(input).toHaveValue("2026-04-01");
    expect(input).toHaveAttribute("min", "2024-10-09");
    expect(input).toHaveAttribute("max", "2026-10-07");
    fireEvent.change(input, { target: { value: "2026-03-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Import history" }));

    expect(await screen.findByText("Added 25 new purchases.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ since: "2026-03-15" }),
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("explains a refused start day without refreshing", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: "invalid_since" }));
    renderImport();
    fireEvent.click(screen.getByRole("button", { name: "Import history" }));

    expect(
      await screen.findByText("Pick a start date in the past, at most two years ago."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
