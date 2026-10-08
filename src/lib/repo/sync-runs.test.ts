import { describe, expect, it } from "vitest";
import { argsOf, createSupabaseMock, methodsOf } from "@/test/supabase-mock";
import {
  finishSyncRun,
  getLatestSyncRun,
  hasRunningSync,
  listSyncStartsSince,
  startSyncRun,
} from "./sync-runs";

const USER = "11111111-1111-4111-8111-111111111111";
const RUN = "33333333-3333-4333-8333-333333333333";

describe("startSyncRun", () => {
  it("inserts a running row and returns its id", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: { id: RUN } });

    await expect(startSyncRun(mock.client, USER, "cron", "2026-10-07T16:00:00.000Z")).resolves.toBe(
      RUN,
    );
    expect(mock.queries[0]!.table).toBe("sync_runs");
    expect(methodsOf(mock.queries[0])).toEqual(["insert", "select", "single"]);
    expect(argsOf(mock.queries[0], "insert")).toEqual([
      [
        {
          user_id: USER,
          trigger: "cron",
          status: "running",
          started_at: "2026-10-07T16:00:00.000Z",
        },
      ],
    ]);
    expect(argsOf(mock.queries[0], "select")).toEqual([["id"]]);
  });

  it("wraps database errors and a missing row in RepoError", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "boom", code: "42501" } }, { data: null });
    await expect(startSyncRun(mock.client, USER, "manual", "x")).rejects.toMatchObject({
      message: "startSyncRun: boom",
      code: "42501",
    });
    await expect(startSyncRun(mock.client, USER, "manual", "x")).rejects.toThrow(
      "startSyncRun: no row returned",
    );
  });
});

describe("finishSyncRun", () => {
  it("updates the user's run with its counts and errors", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null });

    await finishSyncRun(mock.client, USER, RUN, {
      status: "ok",
      finishedAt: "2026-10-07T16:00:05.000Z",
      messagesSeen: 8,
      newTransactions: 4,
      unparsed: 2,
      errors: [{ gmailMessageId: "m1", message: "Gmail API request failed (500)" }],
    });

    expect(methodsOf(mock.queries[0])).toEqual(["update", "eq", "eq"]);
    expect(argsOf(mock.queries[0], "update")).toEqual([
      [
        {
          status: "ok",
          finished_at: "2026-10-07T16:00:05.000Z",
          messages_seen: 8,
          new_transactions: 4,
          unparsed: 2,
          errors: [{ gmailMessageId: "m1", message: "Gmail API request failed (500)" }],
        },
      ],
    ]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([
      ["id", RUN],
      ["user_id", USER],
    ]);
  });

  it("wraps database errors in RepoError", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "boom" } });
    await expect(
      finishSyncRun(mock.client, USER, RUN, {
        status: "error",
        finishedAt: "x",
        messagesSeen: 0,
        newTransactions: 0,
        unparsed: 0,
        errors: [],
      }),
    ).rejects.toThrow("finishSyncRun: boom");
  });
});

describe("hasRunningSync", () => {
  it("looks for a running run of the user started since the given time", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: [{ id: RUN }] }, { data: [] });

    await expect(hasRunningSync(mock.client, USER, "2026-10-07T15:50:00.000Z")).resolves.toBe(true);
    await expect(hasRunningSync(mock.client, USER, "2026-10-07T15:50:00.000Z")).resolves.toBe(
      false,
    );
    expect(mock.queries[0]!.table).toBe("sync_runs");
    expect(methodsOf(mock.queries[0])).toEqual(["select", "eq", "eq", "gte", "limit"]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([
      ["user_id", USER],
      ["status", "running"],
    ]);
    expect(argsOf(mock.queries[0], "gte")).toEqual([["started_at", "2026-10-07T15:50:00.000Z"]]);
  });

  it("wraps database errors in RepoError", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "boom" } });
    await expect(hasRunningSync(mock.client, USER, "x")).rejects.toThrow("hasRunningSync: boom");
  });
});

describe("listSyncStartsSince", () => {
  it("lists the start times of the user's runs with the trigger since the given time", async () => {
    const mock = createSupabaseMock();
    mock.respond({
      data: [
        { started_at: "2026-10-07T15:59:00+00:00" },
        { started_at: "2026-10-07T15:20:00+00:00" },
      ],
    });

    await expect(
      listSyncStartsSince(mock.client, USER, "manual", "2026-10-07T15:00:00.000Z"),
    ).resolves.toEqual(["2026-10-07T15:59:00+00:00", "2026-10-07T15:20:00+00:00"]);
    expect(mock.queries[0]!.table).toBe("sync_runs");
    expect(methodsOf(mock.queries[0])).toEqual(["select", "eq", "eq", "gte", "order", "limit"]);
    expect(argsOf(mock.queries[0], "select")).toEqual([["started_at"]]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([
      ["user_id", USER],
      ["trigger", "manual"],
    ]);
    expect(argsOf(mock.queries[0], "gte")).toEqual([["started_at", "2026-10-07T15:00:00.000Z"]]);
    expect(argsOf(mock.queries[0], "order")).toEqual([["started_at", { ascending: false }]]);
    expect(argsOf(mock.queries[0], "limit")).toEqual([[50]]);
  });

  it("returns an empty list when there are none and wraps database errors", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null }, { error: { message: "boom" } });
    await expect(listSyncStartsSince(mock.client, USER, "manual", "x")).resolves.toEqual([]);
    await expect(listSyncStartsSince(mock.client, USER, "manual", "x")).rejects.toThrow(
      "listSyncStartsSince: boom",
    );
  });
});

describe("getLatestSyncRun", () => {
  const ROW = {
    status: "ok",
    trigger: "cron",
    started_at: "2026-10-07T16:00:00+00:00",
    finished_at: "2026-10-07T16:00:04+00:00",
    new_transactions: 3,
    unparsed: 1,
    errors: [{ gmailMessageId: "m1", message: "timeout" }],
  };

  it("reads the newest run of the user", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: ROW });

    await expect(getLatestSyncRun(mock.client, USER)).resolves.toEqual({
      status: "ok",
      trigger: "cron",
      startedAt: "2026-10-07T16:00:00+00:00",
      finishedAt: "2026-10-07T16:00:04+00:00",
      newTransactions: 3,
      unparsed: 1,
      errorCount: 1,
    });
    expect(mock.queries[0]!.calls).toEqual([
      {
        method: "select",
        args: ["status, trigger, started_at, finished_at, new_transactions, unparsed, errors"],
      },
      { method: "eq", args: ["user_id", USER] },
      { method: "order", args: ["started_at", { ascending: false }] },
      { method: "limit", args: [1] },
      { method: "maybeSingle", args: [] },
    ]);
  });

  it("is null before the first sync", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null });
    await expect(getLatestSyncRun(mock.client, USER)).resolves.toBeNull();
  });

  it("rejects unknown statuses and wraps database errors", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: { ...ROW, status: "paused" } }, { error: { message: "boom" } });
    await expect(getLatestSyncRun(mock.client, USER)).rejects.toThrow('invalid status "paused"');
    await expect(getLatestSyncRun(mock.client, USER)).rejects.toThrow("getLatestSyncRun: boom");
  });
});
