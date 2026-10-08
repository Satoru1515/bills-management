import { describe, expect, it } from "vitest";
import { argsOf, createSupabaseMock, methodsOf } from "@/test/supabase-mock";
import {
  claimImportMonth,
  finishImportMonth,
  listImportMonths,
  queueImportMonths,
} from "./import-months";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-10-08T14:00:00.000Z";

const ROW = {
  id: ID,
  month: "2026-09",
  status: "done",
  attempts: 1,
  next_attempt_at: NOW,
  messages_seen: 40,
  new_transactions: 12,
  last_error: null,
  updated_at: NOW,
};

describe("listImportMonths", () => {
  it("reads the user's queue newest first", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: [ROW] });

    await expect(listImportMonths(mock.client, USER)).resolves.toEqual([
      {
        id: ID,
        month: "2026-09",
        status: "done",
        attempts: 1,
        nextAttemptAt: NOW,
        messagesSeen: 40,
        newTransactions: 12,
        lastError: null,
        updatedAt: NOW,
      },
    ]);
    expect(mock.queries[0]!.table).toBe("import_months");
    expect(argsOf(mock.queries[0], "eq")).toEqual([["user_id", USER]]);
    expect(argsOf(mock.queries[0], "order")).toEqual([["month", { ascending: false }]]);
  });

  it("rejects unknown statuses and wraps errors", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: [{ ...ROW, status: "queued" }] }, { error: { message: "boom" } });
    await expect(listImportMonths(mock.client, USER)).rejects.toThrow('invalid status "queued"');
    await expect(listImportMonths(mock.client, USER)).rejects.toThrow("listImportMonths: boom");
  });
});

describe("queueImportMonths", () => {
  it("adds new months and restarts failed ones", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null }, { data: null });

    await queueImportMonths(mock.client, USER, ["2026-08", "2026-09"], NOW);

    expect(argsOf(mock.queries[0], "upsert")).toEqual([
      [
        [
          { user_id: USER, month: "2026-08", next_attempt_at: NOW },
          { user_id: USER, month: "2026-09", next_attempt_at: NOW },
        ],
        { onConflict: "user_id,month", ignoreDuplicates: true },
      ],
    ]);
    expect(argsOf(mock.queries[1], "update")).toEqual([
      [{ status: "pending", attempts: 0, next_attempt_at: NOW, last_error: null, updated_at: NOW }],
    ]);
    expect(argsOf(mock.queries[1], "in")).toEqual([
      ["month", ["2026-08", "2026-09"]],
      ["status", ["error", "failed"]],
    ]);
  });

  it("does nothing for no months", async () => {
    const mock = createSupabaseMock();
    await queueImportMonths(mock.client, USER, [], NOW);
    expect(mock.queries).toHaveLength(0);
  });
});

describe("claimImportMonth", () => {
  it("takes a month only if it is still in the expected state", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: [{ id: ID }] }, { data: [] });

    await expect(claimImportMonth(mock.client, USER, ID, "pending", NOW, "x")).resolves.toBe(true);
    expect(argsOf(mock.queries[0], "update")).toEqual([[{ status: "running", updated_at: NOW }]]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([
      ["id", ID],
      ["user_id", USER],
      ["status", "pending"],
    ]);
    expect(methodsOf(mock.queries[0])).not.toContain("lt");

    await expect(
      claimImportMonth(mock.client, USER, ID, "running", NOW, "2026-10-08T13:50:00.000Z"),
    ).resolves.toBe(false);
    expect(argsOf(mock.queries[1], "lt")).toEqual([["updated_at", "2026-10-08T13:50:00.000Z"]]);
  });
});

describe("finishImportMonth", () => {
  it("stores the outcome on the user's row", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null });
    await finishImportMonth(
      mock.client,
      USER,
      ID,
      {
        status: "error",
        attempts: 2,
        nextAttemptAt: NOW,
        messagesSeen: 3,
        newTransactions: 1,
        lastError: "Gmail API request failed (500)",
      },
      NOW,
    );
    expect(argsOf(mock.queries[0], "update")).toEqual([
      [
        {
          status: "error",
          attempts: 2,
          next_attempt_at: NOW,
          messages_seen: 3,
          new_transactions: 1,
          last_error: "Gmail API request failed (500)",
          updated_at: NOW,
        },
      ],
    ]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([
      ["id", ID],
      ["user_id", USER],
    ]);
  });
});
