import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  getUsdToDopRate: vi.fn(),
  getGmailConnectionStatus: vi.fn(),
  getLatestSyncRun: vi.fn(),
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
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: mocks.user }, error: null })) },
  })),
}));
vi.mock("@/lib/repo/profiles", () => ({ getUsdToDopRate: mocks.getUsdToDopRate }));
vi.mock("@/lib/repo/gmail-connections", () => ({
  getGmailConnectionStatus: mocks.getGmailConnectionStatus,
}));
vi.mock("@/lib/repo/sync-runs", () => ({ getLatestSyncRun: mocks.getLatestSyncRun }));
vi.mock("@/app/login/actions", () => ({ signInWithGoogleAction: vi.fn() }));
vi.mock("./actions", () => ({ saveRateAction: vi.fn() }));

import { GOOGLE_GRANTED_SCOPES } from "@/lib/auth/google";
import SettingsPage from "./page";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T19:00:00Z"));
  mocks.user = { id: "user-1", email: "satoru@example.com" };
  mocks.getUsdToDopRate.mockReset().mockResolvedValue(62.5);
  mocks.getGmailConnectionStatus.mockReset().mockResolvedValue({
    email: "satoru@gmail.com",
    scope: GOOGLE_GRANTED_SCOPES,
    lastSyncAt: "2026-10-07T18:45:00+00:00",
    connectedAt: "2026-10-01T12:00:00+00:00",
  });
  mocks.getLatestSyncRun.mockReset().mockResolvedValue({
    status: "ok",
    trigger: "cron",
    startedAt: "2026-10-07T18:45:00+00:00",
    finishedAt: "2026-10-07T18:45:04+00:00",
    newTransactions: 2,
    unparsed: 0,
    errorCount: 0,
  });
  return () => vi.useRealTimers();
});

describe("/app/settings page", () => {
  it("shows the rate, the Gmail connection and the last sync", async () => {
    render(await SettingsPage());

    expect(mocks.getUsdToDopRate).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pesos per US dollar")).toHaveValue("62.5");

    const gmail = screen.getByRole("region", { name: "Gmail" });
    expect(gmail).toHaveTextContent("Connected");
    expect(gmail).toHaveTextContent(/Signed in as\s*satoru@example\.com/);
    expect(gmail).toHaveTextContent(/Gmail account\s*satoru@gmail\.com/);
    expect(gmail).toHaveTextContent(/Connected\s*Oct 1, 2026, 8:00 AM/);
    expect(gmail).toHaveTextContent(/Last successful sync\s*Oct 7, 2026, 2:45 PM/);
    expect(gmail).toHaveTextContent("Last automatic sync Oct 7, 2026, 2:45 PM: 2 new purchases.");

    const reconnect = within(gmail).getByRole("button", { name: "Reconnect Gmail" });
    const form = reconnect.closest("form")!;
    expect(form.querySelector('input[name="next"]')).toHaveValue("/app/settings");
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/app");
  });

  it("offers to connect Gmail when there is no connection", async () => {
    mocks.getUsdToDopRate.mockResolvedValue(null);
    mocks.getGmailConnectionStatus.mockResolvedValue(null);
    mocks.getLatestSyncRun.mockResolvedValue(null);
    render(await SettingsPage());

    const gmail = screen.getByRole("region", { name: "Gmail" });
    expect(gmail).toHaveTextContent("Not connected");
    expect(gmail).not.toHaveTextContent("Last successful sync");
    expect(within(gmail).getByRole("button", { name: "Connect Gmail" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pesos per US dollar")).toHaveValue("");
  });

  it("points to reconnecting after a failed sync", async () => {
    mocks.getGmailConnectionStatus.mockResolvedValue({
      email: "satoru@gmail.com",
      scope: GOOGLE_GRANTED_SCOPES,
      lastSyncAt: null,
      connectedAt: "2026-10-01T12:00:00+00:00",
    });
    mocks.getLatestSyncRun.mockResolvedValue({
      status: "error",
      trigger: "manual",
      startedAt: "2026-10-07T18:50:00+00:00",
      finishedAt: "2026-10-07T18:50:01+00:00",
      newTransactions: 0,
      unparsed: 0,
      errorCount: 1,
    });
    render(await SettingsPage());

    const gmail = screen.getByRole("region", { name: "Gmail" });
    expect(gmail).toHaveTextContent("Last sync failed");
    expect(gmail).toHaveTextContent(/Last successful sync\s*Never/);
    expect(gmail).toHaveTextContent("The last manual sync failed (Oct 7, 2026, 2:50 PM).");
  });

  it("sends signed-out visitors to /login", async () => {
    mocks.user = null;
    await expect(SettingsPage()).rejects.toMatchObject({ url: "/login" });
    expect(mocks.getUsdToDopRate).not.toHaveBeenCalled();
  });
});
