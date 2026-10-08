import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  loadDashboard: vi.fn(),
}));

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectError(url);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: mocks.user }, error: null })) },
  })),
}));
vi.mock("@/lib/dashboard/load", () => ({ loadDashboard: mocks.loadDashboard }));

import type { DashboardData } from "@/lib/dashboard/load";
import { summarizeMonth } from "@/lib/domain/summary";
import AppHome from "./page";

const NOW = new Date("2026-10-07T19:00:00Z");

function dashboard(month: string): DashboardData {
  const empty = (m: string) => summarizeMonth([], { month: m, usdToDopRate: 63, now: NOW });
  return {
    month,
    maxMonth: "2026-10",
    usdToDopRate: 63,
    defaultRate: true,
    current: empty(month),
    previous: empty("2026-08"),
    change: null,
    transactions: [],
  };
}

function props(values: Record<string, string | string[]> = {}) {
  return { searchParams: Promise.resolve(values) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.user = { id: "user-1", email: "satoru@example.com" };
  mocks.loadDashboard.mockReset();
  mocks.loadDashboard.mockImplementation(async (_client, _userId, month: string) =>
    dashboard(month),
  );
});
afterEach(() => {
  vi.useRealTimers();
});

describe("/app page", () => {
  it("shows the month from the query", async () => {
    render(await AppHome(props({ month: "2026-09" })));

    expect(mocks.loadDashboard).toHaveBeenCalledWith(expect.anything(), "user-1", "2026-09", NOW);
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    expect(screen.getByLabelText("Month to show")).toHaveValue("2026-09");
    expect(screen.getByText("Total", { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
  });

  it("filters the bank summary by the category in the query", async () => {
    const base = {
      userId: "user-1",
      date: "2026-10-04T20:07:00-04:00",
      month: "2026-10",
      currency: "DOP",
      kind: "consumo",
      ignored: false,
      source: "gmail",
    } as const;
    mocks.loadDashboard.mockResolvedValue({
      ...dashboard("2026-10"),
      transactions: [
        {
          ...base,
          id: "1",
          gmailMessageId: "m1",
          bank: "Scotiabank",
          cardLast4: "1234",
          amount: 900,
          merchant: "BRAVO",
          category: "Supermercado",
        },
        {
          ...base,
          id: "2",
          gmailMessageId: "m2",
          bank: "APAP",
          cardLast4: "9876",
          amount: 300,
          merchant: "SHELL",
          category: "Combustible",
        },
      ],
    } satisfies DashboardData);

    render(await AppHome(props({ month: "2026-10", category: "Supermercado" })));

    expect(screen.getByRole("link", { name: /^Supermercado:/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: /^Combustible:/ })).toBeInTheDocument();
    const banks = screen.getByRole("region", { name: /By bank and card/ });
    expect(banks).toHaveTextContent("Scotiabank");
    expect(banks).not.toHaveTextContent("APAP");
    expect(screen.getByRole("link", { name: /Previous month/ })).toHaveAttribute(
      "href",
      "/app?month=2026-09&category=Supermercado",
    );
  });

  it("ignores an unknown category", async () => {
    render(await AppHome(props({ category: "Nope" })));
    expect(screen.queryByText("Show all categories")).toBeNull();
    expect(screen.getByRole("heading", { name: "By bank and card" })).toBeInTheDocument();
  });

  it("defaults to the current month", async () => {
    render(await AppHome(props({ month: "not-a-month" })));
    expect(mocks.loadDashboard).toHaveBeenCalledWith(expect.anything(), "user-1", "2026-10", NOW);
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
  });

  it("sends signed-out visitors to /login", async () => {
    mocks.user = null;
    await expect(AppHome(props())).rejects.toMatchObject({ url: "/login" });
    expect(mocks.loadDashboard).not.toHaveBeenCalled();
  });
});
