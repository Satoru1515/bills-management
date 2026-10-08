import { describe, expect, it } from "vitest";
import { argsOf, createSupabaseMock, methodsOf } from "@/test/supabase-mock";
import { finishSyncRun, hasRunningSync, startSyncRun } from "./sync-runs";

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
