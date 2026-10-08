import { describe, expect, it } from "vitest";
import { syncFeedback, type SyncResponseBody } from "./feedback";

function body(overrides: Partial<SyncResponseBody> = {}): SyncResponseBody {
  return {
    status: "ok",
    finishedAt: "2026-10-07T16:00:04.000Z",
    messagesSeen: 6,
    newTransactions: 0,
    unparsed: 0,
    duplicates: 0,
    errorCount: 0,
    reconnectRequired: false,
    ...overrides,
  };
}

describe("syncFeedback", () => {
  it("reports new purchases, or that nothing is new", () => {
    expect(syncFeedback(200, body())).toEqual({
      tone: "success",
      message: "Up to date: no new purchases.",
    });
    expect(syncFeedback(200, body({ newTransactions: 1 })).message).toBe("Added 1 new purchase.");
    expect(syncFeedback(200, body({ newTransactions: 12 })).message).toBe(
      "Added 12 new purchases.",
    );
  });

  it("mentions unread emails and errors that will be retried", () => {
    expect(syncFeedback(200, body({ newTransactions: 2, unparsed: 1, errorCount: 3 }))).toEqual({
      tone: "success",
      message:
        "Added 2 new purchases. 1 email from your banks could not be read. " +
        "Some emails could not be loaded; they will be retried on the next sync.",
    });
    expect(syncFeedback(200, body({ unparsed: 2 })).message).toBe(
      "Up to date: no new purchases. 2 emails from your banks could not be read.",
    );
  });

  it("asks for a new Google sign-in when the grant no longer works", () => {
    expect(syncFeedback(200, body({ status: "error", reconnectRequired: true }))).toEqual({
      tone: "error",
      message: "Gmail access has expired or was revoked. Sign out and sign in with Google again.",
    });
  });

  it("explains the other failures", () => {
    const retry = "The sync failed. Please try again later.";
    expect(syncFeedback(200, body({ status: "error" }))).toEqual({ tone: "error", message: retry });
    expect(syncFeedback(401, { error: "unauthorized" }).message).toBe(
      "Your session has ended. Sign in again.",
    );
    expect(syncFeedback(409, { error: "sync_in_progress" }).message).toBe(
      "A sync is already running. Try again in a minute.",
    );
    expect(syncFeedback(500, { error: "sync_failed" }).message).toBe(retry);
    expect(syncFeedback(403, { error: "forbidden" }).message).toBe(retry);
    expect(syncFeedback(200, null).message).toBe(retry);
    expect(syncFeedback(200, { status: "ok" }).message).toBe(retry);
  });
});
