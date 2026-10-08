import { describe, expect, it } from "vitest";
import { GOOGLE_GRANTED_SCOPES } from "@/lib/auth/google";
import type { GmailConnectionStatus } from "@/lib/repo/gmail-connections";
import type { SyncRunRecord } from "@/lib/repo/sync-runs";
import { describeRun, formatDateTime, gmailStatus } from "./gmail-status";

// 2026-10-07 15:00 in the Dominican Republic.
const NOW = new Date("2026-10-07T19:00:00Z");

const CONNECTION: GmailConnectionStatus = {
  email: "satoru@gmail.com",
  scope: GOOGLE_GRANTED_SCOPES,
  lastSyncAt: "2026-10-07T18:45:00+00:00",
  connectedAt: "2026-10-01T12:00:00+00:00",
};

function run(overrides: Partial<SyncRunRecord> = {}): SyncRunRecord {
  return {
    status: "ok",
    trigger: "cron",
    startedAt: "2026-10-07T18:45:00+00:00",
    finishedAt: "2026-10-07T18:45:04+00:00",
    newTransactions: 2,
    unparsed: 0,
    errorCount: 0,
    ...overrides,
  };
}

describe("formatDateTime", () => {
  it("shows the date and time in DR time", () => {
    expect(formatDateTime("2026-10-07T19:00:00Z")).toBe("Oct 7, 2026, 3:00 PM");
    expect(formatDateTime("2027-01-01T03:30:00Z")).toBe("Dec 31, 2026, 11:30 PM");
    expect(formatDateTime("garbage")).toBe("garbage");
  });
});

describe("describeRun", () => {
  it("summarizes the latest run", () => {
    expect(describeRun(null)).toBeNull();
    expect(describeRun(run())).toBe("Last automatic sync Oct 7, 2026, 2:45 PM: 2 new purchases.");
    expect(
      describeRun(run({ trigger: "manual", newTransactions: 1, unparsed: 2, errorCount: 1 })),
    ).toBe("Last manual sync Oct 7, 2026, 2:45 PM: 1 new purchase, 2 emails not read, 1 error.");
    expect(describeRun(run({ status: "error" }))).toBe(
      "The last automatic sync failed (Oct 7, 2026, 2:45 PM).",
    );
    expect(describeRun(run({ status: "running", finishedAt: null }))).toBe(
      "An automatic sync started Oct 7, 2026, 2:45 PM.",
    );
    expect(describeRun(run({ status: "running", trigger: "manual", finishedAt: null }))).toBe(
      "A manual sync started Oct 7, 2026, 2:45 PM.",
    );
  });
});

describe("gmailStatus", () => {
  it("asks to connect when there is no connection", () => {
    expect(gmailStatus(null, null, NOW)).toMatchObject({
      tone: "warning",
      label: "Not connected",
      suggestReconnect: true,
    });
  });

  it("is connected after a successful sync", () => {
    expect(gmailStatus(CONNECTION, run(), NOW)).toEqual({
      tone: "ok",
      label: "Connected",
      detail: "New alerts are read automatically.",
      suggestReconnect: false,
    });
  });

  it("says when it never synced", () => {
    expect(gmailStatus({ ...CONNECTION, lastSyncAt: null }, null, NOW)).toMatchObject({
      tone: "neutral",
      label: "Connected, not synced yet",
      suggestReconnect: false,
    });
  });

  it("suggests reconnecting when the last sync failed", () => {
    expect(gmailStatus(CONNECTION, run({ status: "error" }), NOW)).toMatchObject({
      tone: "error",
      label: "Last sync failed",
      suggestReconnect: true,
    });
  });

  it("shows a recent running sync, but not one that was cut off", () => {
    const started = { status: "running", finishedAt: null } as const;
    expect(
      gmailStatus(CONNECTION, run({ ...started, startedAt: "2026-10-07T18:58:00Z" }), NOW),
    ).toMatchObject({ label: "Syncing", suggestReconnect: false });
    expect(
      gmailStatus(CONNECTION, run({ ...started, startedAt: "2026-10-07T18:00:00Z" }), NOW),
    ).toMatchObject({ label: "Connected" });
  });

  it("flags a connection without the Gmail scope", () => {
    expect(gmailStatus({ ...CONNECTION, scope: "openid email profile" }, run(), NOW)).toMatchObject(
      { tone: "error", label: "Gmail access missing", suggestReconnect: true },
    );
    // An unknown scope (older rows) is not treated as missing.
    expect(gmailStatus({ ...CONNECTION, scope: null }, run(), NOW)).toMatchObject({
      label: "Connected",
    });
  });
});
