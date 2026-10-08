import { describe, expect, it, vi } from "vitest";
import type { ImportMonth, ImportMonthUpdate } from "@/lib/repo/import-months";
import {
  IMPORT_RETRY_DELAYS_MS,
  MAX_IMPORT_ATTEMPTS,
  RATE_LIMIT_WAIT_MS,
  STALE_RUNNING_MS,
  handleImportRequest,
  importWindow,
  monthsFrom,
  runImportStep,
  type ImportDeps,
  type ImportRequestDeps,
  type ImportStepResult,
  type ImportStore,
} from "./import-queue";
import type { SyncResult } from "./run";

const USER = "11111111-1111-4111-8111-111111111111";
// Thursday 8 October 2026, 10 AM in the Dominican Republic.
const NOW = new Date("2026-10-08T14:00:00.000Z");

function result(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    runId: "run-1",
    status: "ok",
    finishedAt: NOW.toISOString(),
    messagesSeen: 12,
    newTransactions: 5,
    unparsed: 1,
    errors: [],
    since: null,
    duplicates: 0,
    alreadyStored: 0,
    reconnectRequired: false,
    rateLimited: false,
    ...overrides,
  };
}

/** An in-memory queue with a clock that tests can move. */
function memoryQueue(initial: Partial<ImportMonth>[] = []) {
  let nextId = 0;
  const clock = { now: new Date(NOW) };
  const rows: ImportMonth[] = initial.map((row) => ({
    id: `m-${++nextId}`,
    month: "2026-10",
    status: "pending",
    attempts: 0,
    nextAttemptAt: NOW.toISOString(),
    messagesSeen: 0,
    newTransactions: 0,
    lastError: null,
    updatedAt: NOW.toISOString(),
    ...row,
  }));
  const store: ImportStore = {
    list: async () =>
      [...rows].sort((a, b) => b.month.localeCompare(a.month)).map((r) => ({ ...r })),
    queue: async (_userId, months, now) => {
      for (const month of months) {
        const existing = rows.find((r) => r.month === month);
        if (!existing) {
          rows.push({
            id: `m-${++nextId}`,
            month,
            status: "pending",
            attempts: 0,
            nextAttemptAt: now,
            messagesSeen: 0,
            newTransactions: 0,
            lastError: null,
            updatedAt: now,
          });
        } else if (existing.status === "error" || existing.status === "failed") {
          Object.assign(existing, { status: "pending", attempts: 0, nextAttemptAt: now });
        }
      }
    },
    claim: async (_userId, month, now) => {
      const row = rows.find((r) => r.id === month.id)!;
      if (row.status !== month.status) return false;
      Object.assign(row, { status: "running", updatedAt: now });
      return true;
    },
    finish: async (_userId, id, update: ImportMonthUpdate, now) => {
      Object.assign(
        rows.find((r) => r.id === id)!,
        { ...update, updatedAt: now },
      );
    },
  };
  return { rows, store, clock };
}

function importDeps(
  queue: ReturnType<typeof memoryQueue>,
  runMonth: ImportDeps["runMonth"] = async () => result(),
  overrides: Partial<ImportDeps> = {},
): ImportDeps {
  return {
    store: queue.store,
    isSyncRunning: async () => false,
    runMonth: vi.fn(runMonth),
    now: () => queue.clock.now,
    ...overrides,
  };
}

describe("monthsFrom", () => {
  it("lists the months from the chosen one to now", () => {
    expect(monthsFrom("2026-07", NOW)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(monthsFrom("2026-10", NOW)).toEqual(["2026-10"]);
  });

  it("refuses malformed, future or too old months", () => {
    for (const value of [undefined, 202607, "2026-7", "2026-11", "2024-10"]) {
      expect(monthsFrom(value, NOW)).toBeNull();
    }
    expect(monthsFrom("2024-11", NOW)).toHaveLength(24);
  });
});

describe("importWindow", () => {
  it("covers the month with a day of margin on each side", () => {
    expect(importWindow("2026-05")).toEqual({
      since: "2026-04-30T04:00:00.000Z",
      until: "2026-06-02T04:00:00.000Z",
    });
  });
});

describe("runImportStep", () => {
  it("queues the last six months the first time and runs them newest first", async () => {
    const queue = memoryQueue();
    const deps = importDeps(queue);

    const step = await runImportStep(deps, USER, 60_000);

    expect(queue.rows.map((r) => r.month).sort()).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(step.processed).toEqual([
      "2026-10",
      "2026-09",
      "2026-08",
      "2026-07",
      "2026-06",
      "2026-05",
    ]);
    expect(vi.mocked(deps.runMonth).mock.calls[0]).toEqual([USER, importWindow("2026-10")]);
    expect(step.progress).toMatchObject({ total: 6, done: 6, percent: 100, active: false });
    expect(step.progress.newTransactions).toBe(30);
    expect(step).toMatchObject({ busy: false, reconnectRequired: false, waitMs: null });
  });

  it("stops starting months once the budget is used", async () => {
    const queue = memoryQueue([{ month: "2026-10" }, { month: "2026-09" }, { month: "2026-08" }]);
    const deps = importDeps(queue, async () => {
      queue.clock.now = new Date(queue.clock.now.getTime() + 15_000);
      return result();
    });
    const step = await runImportStep(deps, USER, 20_000);
    expect(step.processed).toEqual(["2026-10", "2026-09"]);
    expect(step.progress).toMatchObject({ done: 2, waiting: 1, active: true, percent: 66 });
    expect(step.waitMs).toBe(0);
  });

  it("waits for Gmail's per-minute limit without counting a failed attempt", async () => {
    const queue = memoryQueue([{ month: "2026-10" }, { month: "2026-09" }]);
    const deps = importDeps(queue, async () => result({ rateLimited: true, newTransactions: 2 }));

    const step = await runImportStep(deps, USER, 60_000);

    expect(step.processed).toEqual(["2026-10"]);
    expect(step.waitMs).toBe(RATE_LIMIT_WAIT_MS);
    const october = queue.rows.find((r) => r.month === "2026-10")!;
    expect(october).toMatchObject({
      status: "pending",
      attempts: 0,
      newTransactions: 2,
      lastError: "Waiting for Gmail's per-minute limit to reset.",
      nextAttemptAt: new Date(NOW.getTime() + RATE_LIMIT_WAIT_MS).toISOString(),
    });
  });

  it("retries a failing month later and gives up after the last attempt", async () => {
    const queue = memoryQueue([{ month: "2026-10" }]);
    const failing = result({
      errors: [{ gmailMessageId: "m1", message: "Gmail API request failed (500)" }],
    });
    const deps = importDeps(queue, async () => failing);

    const first = await runImportStep(deps, USER, 60_000);
    expect(queue.rows[0]).toMatchObject({
      status: "error",
      attempts: 1,
      lastError: "Gmail API request failed (500)",
      nextAttemptAt: new Date(NOW.getTime() + IMPORT_RETRY_DELAYS_MS[0]!).toISOString(),
    });
    expect(first.waitMs).toBe(IMPORT_RETRY_DELAYS_MS[0]);

    // Not due yet: nothing runs.
    expect((await runImportStep(deps, USER, 60_000)).processed).toEqual([]);

    for (let attempt = 2; attempt <= MAX_IMPORT_ATTEMPTS; attempt++) {
      queue.clock.now = new Date(queue.clock.now.getTime() + 2 * 60 * 60 * 1000);
      await runImportStep(deps, USER, 60_000);
    }
    expect(queue.rows[0]).toMatchObject({ status: "failed", attempts: MAX_IMPORT_ATTEMPTS });
    const last = await runImportStep(deps, USER, 60_000);
    expect(last.progress).toMatchObject({ failed: 1, active: false, percent: 100 });
  });

  it("counts a run that throws as a failed attempt", async () => {
    const queue = memoryQueue([{ month: "2026-10" }]);
    const deps = importDeps(queue, async () => {
      throw new Error("startSyncRun: boom");
    });
    await runImportStep(deps, USER, 60_000);
    expect(queue.rows[0]).toMatchObject({
      status: "error",
      attempts: 1,
      lastError: "startSyncRun: boom",
    });
  });

  it("stops and keeps the month when Gmail must be reconnected", async () => {
    const queue = memoryQueue([{ month: "2026-10" }, { month: "2026-09" }]);
    const deps = importDeps(queue, async () =>
      result({ status: "error", reconnectRequired: true }),
    );
    const step = await runImportStep(deps, USER, 60_000);
    expect(step).toMatchObject({ reconnectRequired: true, processed: ["2026-10"], waitMs: null });
    expect(queue.rows.find((r) => r.month === "2026-10")).toMatchObject({
      status: "pending",
      attempts: 0,
    });
  });

  it("is busy while a sync or another step is running", async () => {
    const queue = memoryQueue([{ month: "2026-10" }]);
    const syncing = await runImportStep(
      importDeps(queue, undefined, { isSyncRunning: async () => true }),
      USER,
    );
    expect(syncing).toMatchObject({ busy: true, processed: [], waitMs: null });

    queue.rows[0]!.status = "running";
    const stepping = await runImportStep(importDeps(queue), USER);
    expect(stepping).toMatchObject({ busy: true, processed: [] });
  });

  it("takes over a month left running by a cut-off request", async () => {
    const queue = memoryQueue([
      {
        month: "2026-10",
        status: "running",
        updatedAt: new Date(NOW.getTime() - STALE_RUNNING_MS - 1000).toISOString(),
      },
    ]);
    const step = await runImportStep(importDeps(queue), USER);
    expect(step.processed).toEqual(["2026-10"]);
    expect(queue.rows[0]!.status).toBe("done");
  });
});

describe("handleImportRequest", () => {
  const SAME_SITE = { origin: "http://localhost:3000", url: "http://localhost:3000/api/import" };
  const STEP = { processed: [], busy: false } as unknown as ImportStepResult;

  function requestDeps(overrides: Partial<ImportRequestDeps> = {}): ImportRequestDeps {
    return {
      getUserId: vi.fn(async () => USER),
      queue: vi.fn(async () => {}),
      step: vi.fn(async () => STEP),
      now: () => NOW,
      ...overrides,
    };
  }

  it("runs a step for the signed-in user", async () => {
    const deps = requestDeps();
    await expect(handleImportRequest(SAME_SITE, deps)).resolves.toEqual({
      status: 200,
      body: STEP,
    });
    expect(deps.queue).not.toHaveBeenCalled();
    expect(deps.step).toHaveBeenCalledWith(USER);
  });

  it("queues the months asked for before the step", async () => {
    const deps = requestDeps();
    await handleImportRequest({ ...SAME_SITE, from: "2026-08" }, deps);
    expect(deps.queue).toHaveBeenCalledWith(USER, ["2026-08", "2026-09", "2026-10"]);
  });

  it("refuses other sites, bad months and signed-out users", async () => {
    const deps = requestDeps({ getUserId: vi.fn(async () => null) });
    await expect(
      handleImportRequest({ origin: "https://evil.example.com", url: SAME_SITE.url }, deps),
    ).resolves.toEqual({ status: 403, body: { error: "forbidden" } });
    await expect(handleImportRequest({ ...SAME_SITE, from: "2030-01" }, deps)).resolves.toEqual({
      status: 400,
      body: { error: "invalid_from" },
    });
    await expect(handleImportRequest(SAME_SITE, deps)).resolves.toEqual({
      status: 401,
      body: { error: "unauthorized" },
    });
    expect(deps.step).not.toHaveBeenCalled();
  });

  it("answers 500 and logs when the step fails", async () => {
    const log = vi.fn();
    const deps = requestDeps({ step: vi.fn(async () => Promise.reject(new Error("boom"))), log });
    await expect(handleImportRequest(SAME_SITE, deps)).resolves.toEqual({
      status: 500,
      body: { error: "import_failed" },
    });
    expect(log).toHaveBeenCalledWith("import step failed: boom");
  });
});
