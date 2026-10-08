import { describe, expect, it, vi } from "vitest";
import {
  RUNNING_SYNC_WINDOW_MS,
  handleCronSync,
  handleManualSync,
  isCronAuthorized,
  isSameOrigin,
  runCronSync,
  runningSince,
  toResponseBody,
  type CronSyncDeps,
  type ManualSyncDeps,
} from "./requests";
import type { SyncResult } from "./run";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-07T16:00:00.000Z");
// Test-only secret; never a real one.
const SECRET = "test-cron-secret-0123456789abcdef";

function result(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    runId: "run-1",
    status: "ok",
    finishedAt: "2026-10-07T16:00:04.000Z",
    messagesSeen: 6,
    newTransactions: 3,
    unparsed: 1,
    errors: [],
    since: "2026-10-06T16:00:00.000Z",
    duplicates: 2,
    alreadyStored: 1,
    reconnectRequired: false,
    rateLimited: false,
    ...overrides,
  };
}

const SAME_SITE = { origin: "http://localhost:3000", url: "http://localhost:3000/api/sync" };

function manualDeps(overrides: Partial<ManualSyncDeps> = {}): ManualSyncDeps {
  return {
    getUserId: vi.fn(async () => USER),
    isSyncRunning: vi.fn(async () => false),
    listManualSyncStarts: vi.fn(async () => []),
    runSync: vi.fn(async () => result()),
    now: () => NOW,
    ...overrides,
  };
}

describe("toResponseBody", () => {
  it("keeps the counts and replaces the error details with their count", () => {
    const body = toResponseBody(
      result({ errors: [{ gmailMessageId: "m1", message: "Gmail API request failed (500)" }] }),
    );
    expect(body).toEqual({
      status: "ok",
      finishedAt: "2026-10-07T16:00:04.000Z",
      messagesSeen: 6,
      newTransactions: 3,
      unparsed: 1,
      duplicates: 2,
      errorCount: 1,
      reconnectRequired: false,
    });
    expect(JSON.stringify(body)).not.toContain("m1");
  });
});

describe("runningSince", () => {
  it("is the start of the window in which a running sync blocks another", () => {
    expect(runningSince(NOW)).toBe(new Date(NOW.getTime() - RUNNING_SYNC_WINDOW_MS).toISOString());
    expect(runningSince(NOW)).toBe("2026-10-07T15:50:00.000Z");
  });
});

describe("isSameOrigin", () => {
  it("accepts this site and requests without Origin", () => {
    expect(isSameOrigin("http://localhost:3000", "http://localhost:3000/api/sync")).toBe(true);
    expect(isSameOrigin(null, "http://localhost:3000/api/sync")).toBe(true);
  });

  it("rejects other sites, other ports or schemes, and unreadable values", () => {
    const url = "https://bills.example.com/api/sync";
    expect(isSameOrigin("https://evil.example.com", url)).toBe(false);
    expect(isSameOrigin("http://bills.example.com", url)).toBe(false);
    expect(isSameOrigin("https://bills.example.com:8443", url)).toBe(false);
    expect(isSameOrigin("null", url)).toBe(false);
    expect(isSameOrigin("", url)).toBe(false);
  });
});

describe("handleManualSync", () => {
  it("syncs the signed-in user and returns the outcome", async () => {
    const deps = manualDeps();
    const response = await handleManualSync(SAME_SITE, deps);

    expect(response).toEqual({ status: 200, body: toResponseBody(result()) });
    expect(deps.isSyncRunning).toHaveBeenCalledWith(USER, "2026-10-07T15:50:00.000Z");
    expect(deps.listManualSyncStarts).toHaveBeenCalledWith(USER, "2026-10-07T15:00:00.000Z");
    expect(deps.runSync).toHaveBeenCalledWith(USER);
  });

  it("returns a run that ended in error as a 200 with its status", async () => {
    const deps = manualDeps({
      runSync: vi.fn(async () => result({ status: "error", reconnectRequired: true })),
    });
    const response = await handleManualSync(SAME_SITE, deps);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "error", reconnectRequired: true });
  });

  it("refuses requests from another site before reading the session", async () => {
    const deps = manualDeps();
    const response = await handleManualSync(
      { origin: "https://evil.example.com", url: SAME_SITE.url },
      deps,
    );
    expect(response).toEqual({ status: 403, body: { error: "forbidden" } });
    expect(deps.getUserId).not.toHaveBeenCalled();
    expect(deps.runSync).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    const deps = manualDeps({ getUserId: vi.fn(async () => null) });
    await expect(handleManualSync(SAME_SITE, deps)).resolves.toEqual({
      status: 401,
      body: { error: "unauthorized" },
    });
    expect(deps.runSync).not.toHaveBeenCalled();
  });

  it("does not start a second sync while one is running", async () => {
    const deps = manualDeps({ isSyncRunning: vi.fn(async () => true) });
    await expect(handleManualSync(SAME_SITE, deps)).resolves.toEqual({
      status: 409,
      body: { error: "sync_in_progress" },
    });
    expect(deps.runSync).not.toHaveBeenCalled();
  });

  it("answers 429 with Retry-After when the user synced too recently", async () => {
    const deps = manualDeps({
      listManualSyncStarts: vi.fn(async () => ["2026-10-07T15:59:30.000Z"]),
    });
    await expect(handleManualSync(SAME_SITE, deps)).resolves.toEqual({
      status: 429,
      body: { error: "rate_limited", retryAfterSeconds: 30 },
      headers: { "Retry-After": "30" },
    });
    expect(deps.runSync).not.toHaveBeenCalled();
  });

  it("answers 429 after ten manual syncs in an hour", async () => {
    // Ten syncs, 5 to 50 minutes ago: free again when the one 50 minutes ago is an hour old.
    const starts = Array.from({ length: 10 }, (_, i) =>
      new Date(NOW.getTime() - (5 + i * 5) * 60_000).toISOString(),
    );
    const deps = manualDeps({ listManualSyncStarts: vi.fn(async () => starts) });
    const response = await handleManualSync(SAME_SITE, deps);
    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: "rate_limited", retryAfterSeconds: 600 });
    expect(deps.runSync).not.toHaveBeenCalled();
  });

  it("reports a running sync before the rate limit", async () => {
    const deps = manualDeps({
      isSyncRunning: vi.fn(async () => true),
      listManualSyncStarts: vi.fn(async () => [NOW.toISOString()]),
    });
    expect((await handleManualSync(SAME_SITE, deps)).status).toBe(409);
    expect(deps.listManualSyncStarts).not.toHaveBeenCalled();
  });

  it("answers 500 without details when something throws, and logs it", async () => {
    const log = vi.fn();
    for (const broken of [
      { getUserId: vi.fn(async () => Promise.reject(new Error("auth down"))) },
      { isSyncRunning: vi.fn(async () => Promise.reject(new Error("db down"))) },
      { listManualSyncStarts: vi.fn(async () => Promise.reject(new Error("db timeout"))) },
      { runSync: vi.fn(async () => Promise.reject(new Error("Missing environment variable"))) },
    ]) {
      const response = await handleManualSync(SAME_SITE, manualDeps({ ...broken, log }));
      expect(response).toEqual({ status: 500, body: { error: "sync_failed" } });
    }
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      "manual sync failed: auth down",
      "manual sync failed: db down",
      "manual sync failed: db timeout",
      "manual sync failed: Missing environment variable",
    ]);
  });
});

describe("isCronAuthorized", () => {
  it("accepts exactly Bearer <secret>", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isCronAuthorized(`Bearer ${SECRET}`, ` ${SECRET}\n`)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isCronAuthorized(null, SECRET)).toBe(false);
    expect(isCronAuthorized("", SECRET)).toBe(false);
    expect(isCronAuthorized(SECRET, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isCronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isCronAuthorized("Bearer wrong", SECRET)).toBe(false);
  });

  it("is never true without a configured secret", () => {
    expect(isCronAuthorized("Bearer ", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer ", "   ")).toBe(false);
  });
});

function cronDeps(overrides: Partial<CronSyncDeps> = {}): CronSyncDeps {
  return {
    listConnectedUserIds: vi.fn(async () => [USER, OTHER_USER]),
    isSyncRunning: vi.fn(async () => false),
    runSync: vi.fn(async () => result()),
    now: () => NOW,
    ...overrides,
  };
}

describe("runCronSync", () => {
  it("syncs every connected user in turn and adds up the outcome", async () => {
    const deps = cronDeps({
      runSync: vi.fn(async (userId: string) =>
        userId === USER
          ? result({ newTransactions: 4 })
          : result({ status: "error", newTransactions: 0, reconnectRequired: true }),
      ),
    });

    await expect(runCronSync(deps)).resolves.toEqual({
      users: 2,
      ok: 1,
      failed: 1,
      skipped: 0,
      reconnectRequired: 1,
      newTransactions: 4,
      importedMonths: 0,
    });
    expect(vi.mocked(deps.runSync).mock.calls).toEqual([[USER], [OTHER_USER]]);
    expect(deps.isSyncRunning).toHaveBeenCalledWith(USER, "2026-10-07T15:50:00.000Z");
  });

  it("skips users with a sync running and keeps going after one that throws", async () => {
    const log = vi.fn();
    const third = "33333333-3333-4333-8333-333333333333";
    const deps = cronDeps({
      listConnectedUserIds: vi.fn(async () => [USER, OTHER_USER, third]),
      isSyncRunning: vi.fn(async (userId: string) => userId === USER),
      runSync: vi.fn(async (userId: string) => {
        if (userId === OTHER_USER) throw new Error("finishSyncRun: boom");
        return result({ newTransactions: 2 });
      }),
      log,
    });

    await expect(runCronSync(deps)).resolves.toEqual({
      users: 3,
      ok: 1,
      failed: 1,
      skipped: 1,
      reconnectRequired: 0,
      newTransactions: 2,
      importedMonths: 0,
    });
    expect(vi.mocked(deps.runSync).mock.calls).toEqual([[OTHER_USER], [third]]);
    expect(log).toHaveBeenCalledWith(
      `cron sync failed for user ${OTHER_USER}: finishSyncRun: boom`,
    );
  });

  it("works a little of each user's import queue, except when Gmail must be reconnected", async () => {
    const step = vi.fn(async (userId: string) => ({
      processed: userId === USER ? ["2026-05", "2026-04"] : [],
    }));
    const deps = cronDeps({
      runSync: vi.fn(async (userId: string) =>
        userId === USER ? result() : result({ status: "error", reconnectRequired: true }),
      ),
      runImportStep: step as unknown as CronSyncDeps["runImportStep"],
    });
    await expect(runCronSync(deps)).resolves.toMatchObject({ importedMonths: 2 });
    expect(step.mock.calls).toEqual([[USER]]);
  });

  it("does nothing when no user has Gmail connected", async () => {
    const deps = cronDeps({ listConnectedUserIds: vi.fn(async () => []) });
    await expect(runCronSync(deps)).resolves.toMatchObject({ users: 0, ok: 0, failed: 0 });
    expect(deps.runSync).not.toHaveBeenCalled();
  });
});

describe("handleCronSync", () => {
  it("runs the sync for an authorized call", async () => {
    const deps = cronDeps();
    const response = await handleCronSync(`Bearer ${SECRET}`, SECRET, deps);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ users: 2, ok: 2, newTransactions: 6 });
  });

  it("answers 401 to a wrong or missing token without syncing", async () => {
    const deps = cronDeps();
    for (const header of [null, "Bearer nope"]) {
      await expect(handleCronSync(header, SECRET, deps)).resolves.toEqual({
        status: 401,
        body: { error: "unauthorized" },
      });
    }
    expect(deps.listConnectedUserIds).not.toHaveBeenCalled();
  });

  it("refuses to run when CRON_SECRET is not set", async () => {
    const log = vi.fn();
    const deps = cronDeps({ log });
    await expect(handleCronSync("Bearer ", undefined, deps)).resolves.toEqual({
      status: 500,
      body: { error: "cron_not_configured" },
    });
    expect(deps.listConnectedUserIds).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("cron sync refused: CRON_SECRET is not set");
  });

  it("answers 500 when the users cannot be listed", async () => {
    const log = vi.fn();
    const deps = cronDeps({
      listConnectedUserIds: vi.fn(async () => Promise.reject(new Error("db down"))),
      log,
    });
    await expect(handleCronSync(`Bearer ${SECRET}`, SECRET, deps)).resolves.toEqual({
      status: 500,
      body: { error: "sync_failed" },
    });
    expect(log).toHaveBeenCalledWith("cron sync failed: db down");
  });
});
