import { describe, expect, it } from "vitest";
import { argsOf, createSupabaseMock, methodsOf } from "@/test/supabase-mock";
import {
  ID_FILTER_CHUNK_SIZE,
  LIST_PAGE_SIZE,
  RepoError,
  UPSERT_CHUNK_SIZE,
  listByMonth,
  listStoredMessageIds,
  setIgnored,
  toTransaction,
  updateCategory,
  upsertMany,
  type NewTransaction,
  type TransactionRow,
} from "./transactions";

const USER = "11111111-1111-4111-8111-111111111111";
const TX_ID = "22222222-2222-4222-8222-222222222222";
const COLUMNS =
  "id, user_id, gmail_message_id, date, month, bank, card_last4, amount, currency, merchant, kind, category, ignored, source";

function newTx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    gmailMessageId: "msg-1",
    date: "2026-10-04T19:35:00-04:00",
    month: "2026-10",
    bank: "Scotiabank",
    cardLast4: "7341",
    amount: 5986.9,
    currency: "DOP",
    merchant: "SUPERM. NACIONAL MAXIM",
    kind: "consumo",
    category: "Supermercado",
    ...overrides,
  };
}

/** A row as PostgREST returns it: timestamps in UTC. */
function row(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: TX_ID,
    user_id: USER,
    gmail_message_id: "msg-1",
    date: "2026-10-04T23:35:00+00:00",
    month: "2026-10",
    bank: "Scotiabank",
    card_last4: "7341",
    amount: 5986.9,
    currency: "DOP",
    merchant: "SUPERM. NACIONAL MAXIM",
    kind: "consumo",
    category: "Supermercado",
    ignored: false,
    source: "gmail",
    ...overrides,
  };
}

const EXPECTED_TX = {
  id: TX_ID,
  userId: USER,
  gmailMessageId: "msg-1",
  date: "2026-10-04T19:35:00-04:00",
  month: "2026-10",
  bank: "Scotiabank",
  cardLast4: "7341",
  amount: 5986.9,
  currency: "DOP",
  merchant: "SUPERM. NACIONAL MAXIM",
  kind: "consumo",
  category: "Supermercado",
  ignored: false,
  source: "gmail",
};

describe("upsertMany", () => {
  it("does not query when there is nothing to store", async () => {
    const mock = createSupabaseMock();
    await expect(upsertMany(mock.client, USER, [])).resolves.toEqual({ inserted: [], skipped: 0 });
    expect(mock.queries).toHaveLength(0);
  });

  it("inserts snake_case rows and leaves already saved messages untouched", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: [row()] });

    const result = await upsertMany(mock.client, USER, [
      newTx(),
      newTx({ gmailMessageId: "msg-2", merchant: "UBER", category: "Transporte" }),
    ]);

    const [query] = mock.queries;
    expect(query.table).toBe("transactions");
    expect(methodsOf(query)).toEqual(["upsert", "select"]);
    const [[rows, options]] = argsOf(query, "upsert");
    expect(options).toEqual({ onConflict: "user_id,gmail_message_id", ignoreDuplicates: true });
    expect(rows).toEqual([
      {
        user_id: USER,
        gmail_message_id: "msg-1",
        date: "2026-10-04T19:35:00-04:00",
        month: "2026-10",
        bank: "Scotiabank",
        card_last4: "7341",
        amount: 5986.9,
        currency: "DOP",
        merchant: "SUPERM. NACIONAL MAXIM",
        kind: "consumo",
        category: "Supermercado",
        source: "gmail",
      },
      expect.objectContaining({
        gmail_message_id: "msg-2",
        merchant: "UBER",
        category: "Transporte",
      }),
    ]);
    expect(argsOf(query, "select")).toEqual([[COLUMNS]]);
    expect(result).toEqual({ inserted: [EXPECTED_TX], skipped: 1 });
  });

  it("never sends ignored, so the user's choice survives a re-sync", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: [] });
    await upsertMany(mock.client, USER, [newTx()]);
    const [[rows]] = argsOf(mock.queries[0], "upsert");
    expect(rows).toEqual([expect.not.objectContaining({ ignored: expect.anything() })]);
  });

  it("sends each Gmail message once even if it is repeated in the input", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: [row()] });
    const result = await upsertMany(mock.client, USER, [newTx(), newTx({ merchant: "OTHER" })]);
    const [[rows]] = argsOf(mock.queries[0], "upsert");
    expect(rows).toEqual([expect.objectContaining({ merchant: "SUPERM. NACIONAL MAXIM" })]);
    expect(result.skipped).toBe(1);
  });

  it(`splits large imports into requests of ${UPSERT_CHUNK_SIZE} rows`, async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: [] }, { data: [] });
    const items = Array.from({ length: UPSERT_CHUNK_SIZE + 1 }, (_, i) =>
      newTx({ gmailMessageId: `msg-${i}` }),
    );

    const result = await upsertMany(mock.client, USER, items);

    const sizes = mock.queries.map((query) => (argsOf(query, "upsert")[0][0] as unknown[]).length);
    expect(sizes).toEqual([UPSERT_CHUNK_SIZE, 1]);
    expect(result).toEqual({ inserted: [], skipped: UPSERT_CHUNK_SIZE + 1 });
  });

  it("throws a RepoError with the database code", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "new row violates check constraint", code: "23514" } });
    const error = await upsertMany(mock.client, USER, [newTx()]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RepoError);
    expect(error).toMatchObject({
      message: "upsertMany: new row violates check constraint",
      code: "23514",
    });
  });
});

describe("listByMonth", () => {
  it("rejects a malformed month without querying", async () => {
    const mock = createSupabaseMock();
    await expect(listByMonth(mock.client, USER, "2026-13")).rejects.toThrow(RepoError);
    await expect(listByMonth(mock.client, USER, "2026-1")).rejects.toThrow("expected YYYY-MM");
    expect(mock.queries).toHaveLength(0);
  });

  it("filters by user and month, newest first, and maps rows to DR time", async () => {
    const mock = createSupabaseMock();
    mock.respond({
      data: [row(), row({ id: "tx-2", amount: "12.50" as unknown as number, currency: "USD" })],
    });

    const result = await listByMonth(mock.client, USER, "2026-10");

    expect(mock.queries[0].calls).toEqual([
      { method: "select", args: [COLUMNS] },
      { method: "eq", args: ["user_id", USER] },
      { method: "eq", args: ["month", "2026-10"] },
      { method: "order", args: ["date", { ascending: false }] },
      { method: "order", args: ["id", { ascending: true }] },
      { method: "range", args: [0, LIST_PAGE_SIZE - 1] },
    ]);
    expect(result).toEqual([
      EXPECTED_TX,
      { ...EXPECTED_TX, id: "tx-2", amount: 12.5, currency: "USD" },
    ]);
  });

  it("keeps a purchase made late at night in its DR day", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: [row({ date: "2026-11-01T03:59:00+00:00" })] });
    const [tx] = await listByMonth(mock.client, USER, "2026-10");
    expect(tx.date).toBe("2026-10-31T23:59:00-04:00");
  });

  it("reads every page when a month has more rows than one response holds", async () => {
    const mock = createSupabaseMock();
    const fullPage = Array.from({ length: LIST_PAGE_SIZE }, (_, i) => row({ id: `tx-${i}` }));
    mock.respond({ data: fullPage }, { data: [row({ id: "last" })] });

    const result = await listByMonth(mock.client, USER, "2026-10");

    expect(result).toHaveLength(LIST_PAGE_SIZE + 1);
    expect(result.at(-1)?.id).toBe("last");
    expect(mock.queries.map((query) => argsOf(query, "range")[0])).toEqual([
      [0, LIST_PAGE_SIZE - 1],
      [LIST_PAGE_SIZE, 2 * LIST_PAGE_SIZE - 1],
    ]);
  });

  it("returns an empty list for a month without purchases", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: [] });
    await expect(listByMonth(mock.client, USER, "2026-09")).resolves.toEqual([]);
  });

  it("throws a RepoError when the query fails", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "JWT expired", code: "PGRST301" } });
    await expect(listByMonth(mock.client, USER, "2026-10")).rejects.toMatchObject({
      name: "RepoError",
      code: "PGRST301",
    });
  });
});

describe("updateCategory", () => {
  it("updates only the user's row and returns it", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: row({ category: "Hogar" }) });

    const result = await updateCategory(mock.client, USER, TX_ID, "Hogar");

    expect(mock.queries[0].calls).toEqual([
      { method: "update", args: [{ category: "Hogar" }] },
      { method: "eq", args: ["id", TX_ID] },
      { method: "eq", args: ["user_id", USER] },
      { method: "select", args: [COLUMNS] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(result).toEqual({ ...EXPECTED_TX, category: "Hogar" });
  });

  it("rejects an unknown category without querying", async () => {
    const mock = createSupabaseMock();
    await expect(updateCategory(mock.client, USER, TX_ID, "Mascotas")).rejects.toThrow(
      'unknown category "Mascotas"',
    );
    expect(mock.queries).toHaveLength(0);
  });

  it("returns null when the transaction does not exist or is not the user's", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null });
    await expect(updateCategory(mock.client, USER, TX_ID, "Hogar")).resolves.toBeNull();
  });
});

describe("setIgnored", () => {
  it.each([true, false])("sets ignored to %s", async (ignored) => {
    const mock = createSupabaseMock();
    mock.respond({ data: row({ ignored }) });

    const result = await setIgnored(mock.client, USER, TX_ID, ignored);

    expect(methodsOf(mock.queries[0])).toEqual(["update", "eq", "eq", "select", "maybeSingle"]);
    expect(argsOf(mock.queries[0], "update")).toEqual([[{ ignored }]]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([
      ["id", TX_ID],
      ["user_id", USER],
    ]);
    expect(result?.ignored).toBe(ignored);
  });

  it("returns null when nothing was updated", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null });
    await expect(setIgnored(mock.client, USER, TX_ID, true)).resolves.toBeNull();
  });

  it("throws a RepoError when the update fails", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "permission denied" } });
    await expect(setIgnored(mock.client, USER, TX_ID, true)).rejects.toThrow(
      "setIgnored: permission denied",
    );
  });
});

describe("toTransaction", () => {
  it("keeps a null Gmail id for manual entries", () => {
    expect(toTransaction(row({ gmail_message_id: null, source: "manual" }))).toMatchObject({
      gmailMessageId: null,
      source: "manual",
    });
  });

  it.each([
    ["bank", { bank: "BHD" }],
    ["currency", { currency: "EUR" }],
    ["category", { category: "Mascotas" }],
    ["source", { source: "csv" }],
    ["kind", { kind: "pago" }],
    ["date", { date: "not a date" }],
  ])("rejects a row with an invalid %s", (key, overrides) => {
    expect(() => toTransaction(row(overrides))).toThrow(`invalid ${key}`);
  });
});

describe("listStoredMessageIds", () => {
  it("does not query for an empty list", async () => {
    const mock = createSupabaseMock();
    await expect(listStoredMessageIds(mock.client, USER, [])).resolves.toEqual(new Set());
    expect(mock.queries).toHaveLength(0);
  });

  it("returns the stored ids among the given ones, in chunks, for the user only", async () => {
    const ids = Array.from({ length: ID_FILTER_CHUNK_SIZE + 2 }, (_, i) => `m${i}`);
    const last = `m${ID_FILTER_CHUNK_SIZE + 1}`;
    const mock = createSupabaseMock();
    mock.respond(
      { data: [{ gmail_message_id: "m1" }, { gmail_message_id: "m7" }] },
      { data: [{ gmail_message_id: last }] },
    );

    // "m1" repeated: ids are deduplicated before querying.
    const stored = await listStoredMessageIds(mock.client, USER, [...ids, "m1"]);

    expect(stored).toEqual(new Set(["m1", "m7", last]));
    expect(mock.queries).toHaveLength(2);
    expect(methodsOf(mock.queries[0])).toEqual(["select", "eq", "in"]);
    expect(argsOf(mock.queries[0], "select")).toEqual([["gmail_message_id"]]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([["user_id", USER]]);
    expect(argsOf(mock.queries[0], "in")).toEqual([
      ["gmail_message_id", ids.slice(0, ID_FILTER_CHUNK_SIZE)],
    ]);
    expect(argsOf(mock.queries[1], "in")).toEqual([
      ["gmail_message_id", ids.slice(ID_FILTER_CHUNK_SIZE)],
    ]);
  });

  it("wraps database errors in RepoError", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "boom" } });
    await expect(listStoredMessageIds(mock.client, USER, ["m1"])).rejects.toThrow(RepoError);
  });
});
