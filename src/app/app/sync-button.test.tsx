import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { SyncButton } from "./sync-button";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const OK_BODY = {
  status: "ok",
  finishedAt: "2026-10-07T16:00:04.000Z",
  messagesSeen: 4,
  newTransactions: 3,
  unparsed: 0,
  duplicates: 1,
  errorCount: 0,
  reconnectRequired: false,
};

describe("SyncButton", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    refresh.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to /api/sync, shows the result and refreshes the page", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<SyncButton />);

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    const busy = screen.getByRole("button", { name: "Syncing…" });
    expect(busy).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith("/api/sync", { method: "POST" });

    resolve(jsonResponse(200, OK_BODY));
    expect(await screen.findByText("Added 3 new purchases.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows why a sync could not run and does not refresh", async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: "sync_in_progress" }));
    render(<SyncButton />);

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(
      await screen.findByText("A sync is already running. Try again in a minute."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("handles a network failure and a body that is not JSON", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("<html>Gateway timeout</html>", { status: 504 }));
    render(<SyncButton />);

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(
      await screen.findByText("Could not reach the server. Check your connection."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "The sync failed. Please try again later.",
      ),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
