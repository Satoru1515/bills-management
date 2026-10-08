import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import type { ImportProgress } from "@/lib/sync/import-progress";
import { ImportPanel } from "./import-panel";

function progress(overrides: Partial<ImportProgress> = {}): ImportProgress {
  return {
    total: 6,
    done: 6,
    failed: 0,
    waiting: 0,
    running: null,
    percent: 100,
    newTransactions: 80,
    nextAttemptAt: null,
    active: false,
    oldestMonth: "2026-05",
    months: ["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"].map((month) => ({
      month,
      status: "done" as const,
    })),
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stepReply(p: ImportProgress, extra: Record<string, unknown> = {}) {
  return json({
    progress: p,
    processed: [],
    busy: false,
    reconnectRequired: false,
    waitMs: null,
    ...extra,
  });
}

const PROPS = { currentMonth: "2026-10", minMonth: "2024-11" };

describe("ImportPanel", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    refresh.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows a finished import without calling the server", () => {
    render(<ImportPanel initial={progress()} {...PROPS} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("100% · 6 of 6 months")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "6 of 6 months imported · 80 purchases found",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts the queue when nothing was imported yet and refreshes after each month", async () => {
    const half = progress({ done: 3, waiting: 3, percent: 50, active: true });
    fetchMock
      .mockResolvedValueOnce(stepReply(half, { processed: ["2026-10", "2026-09", "2026-08"] }))
      .mockResolvedValueOnce(new Promise<Response>(() => {}) as unknown as Response);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });

    render(
      <ImportPanel
        initial={progress({ total: 0, done: 0, percent: 0, months: [], oldestMonth: null })}
        {...PROPS}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Preparing the last six months…");
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledWith("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(refresh).toHaveBeenCalledOnce();

    // The next step follows by itself.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("counts down while Gmail's limit resets, then continues", async () => {
    const waiting = progress({ done: 2, waiting: 4, percent: 33, active: true });
    fetchMock
      .mockResolvedValueOnce(stepReply(waiting, { waitMs: 65_000 }))
      .mockResolvedValueOnce(stepReply(progress()));
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });

    render(<ImportPanel initial={waiting} {...PROPS} />);
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent(
      "Waiting for Gmail's limit to reset · continues in 1:05",
    );

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("continues in 1:00");

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("6 of 6 months imported");
  });

  it("estimates the time before importing more months", async () => {
    fetchMock.mockResolvedValue(
      stepReply(progress({ total: 12, done: 6, waiting: 6, percent: 50, active: true })),
    );
    render(<ImportPanel initial={progress()} {...PROPS} />);

    const input = screen.getByLabelText("Import more months, from");
    expect(input).toHaveValue("2025-11");
    fireEvent.change(input, { target: { value: "2025-11" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    const notice = screen.getByRole("alertdialog");
    // November 2025 to April 2026 are new: 6 months at 1.5 minutes each.
    expect(notice).toHaveTextContent("Import 6 more months?");
    expect(notice).toHaveTextContent("This can take about 9 minutes");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/import",
      expect.objectContaining({ body: JSON.stringify({ from: "2025-11" }) }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks to reconnect Gmail when access expired", async () => {
    fetchMock.mockResolvedValue(
      stepReply(progress({ active: true, waiting: 1, done: 5 }), { reconnectRequired: true }),
    );
    render(<ImportPanel initial={progress({ active: true, waiting: 1, done: 5 })} {...PROPS} />);
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent(
      "Gmail access expired. Reconnect Gmail in Settings to continue.",
    );
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute(
      "href",
      "/app/settings",
    );
  });

  it("offers to try again after an error", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "import_failed" }, 500));
    render(<ImportPanel initial={progress({ active: true, waiting: 1, done: 5 })} {...PROPS} />);
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent("The import could not continue.");

    fetchMock.mockResolvedValueOnce(stepReply(progress()));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
