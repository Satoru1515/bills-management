// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BANKS, CATEGORIES, CURRENCIES } from "@/lib/domain/types";
import { createMigratedDb, createUser, migrationFiles } from "./pglite";

const TABLES = ["profiles", "gmail_connections", "transactions", "category_rules", "sync_runs"];

interface TxOverrides {
  gmail_message_id?: string | null;
  month?: string;
  bank?: string;
  card_last4?: string;
  amount?: number;
  currency?: string;
  merchant?: string;
  category?: string;
  source?: string;
}

let db: PGlite;
let userId: string;

async function insertTx(owner: string, overrides: TxOverrides = {}) {
  const row = {
    gmail_message_id: "msg-1",
    month: "2026-10",
    bank: "Scotiabank",
    card_last4: "7341",
    amount: 5986.9,
    currency: "DOP",
    merchant: "SUPERM. NACIONAL MAXIM",
    category: "Supermercado",
    source: "gmail",
    ...overrides,
  };
  return db.query<{ id: string; amount: string; ignored: boolean; kind: string }>(
    `insert into public.transactions
       (user_id, gmail_message_id, date, month, bank, card_last4, amount, currency, merchant, category, source)
     values ($1, $2, '2026-10-04T19:35:00-04:00', $3, $4, $5, $6, $7, $8, $9, $10)
     returning id, amount, ignored, kind`,
    [
      owner,
      row.gmail_message_id,
      row.month,
      row.bank,
      row.card_last4,
      row.amount,
      row.currency,
      row.merchant,
      row.category,
      row.source,
    ],
  );
}

/** Values allowed by a `col in ('a', 'b')` check constraint, read back from the catalog. */
async function allowedValues(table: string, constraint: string): Promise<string[]> {
  const result = await db.query<{ def: string }>(
    `select pg_get_constraintdef(c.oid) as def
       from pg_constraint c
      where c.conrelid = $1::regclass and c.conname = $2`,
    [`public.${table}`, constraint],
  );
  expect(result.rows).toHaveLength(1);
  return [...result.rows[0].def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
}

beforeAll(async () => {
  db = await createMigratedDb();
}, 30_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("delete from auth.users");
  userId = await createUser(db, "satoru@example.com", { full_name: "Satoru" });
});

describe("migration files", () => {
  it("starts with 0001_init.sql and uses numbered names", () => {
    const files = migrationFiles();
    expect(files[0]).toBe("0001_init.sql");
    for (const file of files) expect(file).toMatch(/^\d{4,}_[a-z0-9_]+\.sql$/);
  });
});

describe("schema", () => {
  it("creates every table with RLS enabled", async () => {
    const result = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r'
        order by relname`,
    );
    expect(result.rows.map((r) => r.relname)).toEqual([...TABLES].sort());
    for (const row of result.rows) expect(row.relrowsecurity, row.relname).toBe(true);
  });

  it("keeps bank, currency and category values in sync with the domain types", async () => {
    expect(await allowedValues("transactions", "transactions_bank_check")).toEqual([...BANKS]);
    expect(await allowedValues("transactions", "transactions_currency_check")).toEqual([
      ...CURRENCIES,
    ]);
    expect(await allowedValues("transactions", "transactions_category_check")).toEqual([
      ...CATEGORIES,
    ]);
    expect(await allowedValues("category_rules", "category_rules_category_check")).toEqual([
      ...CATEGORIES,
    ]);
  });
});

describe("profiles", () => {
  it("is created on sign-up with the email and name from the auth metadata", async () => {
    const result = await db.query<{ email: string; display_name: string | null }>(
      "select email, display_name from public.profiles where id = $1",
      [userId],
    );
    expect(result.rows).toEqual([{ email: "satoru@example.com", display_name: "Satoru" }]);
  });

  it("falls back to the `name` metadata key and to null", async () => {
    const named = await createUser(db, "a@example.com", { name: "Ana" });
    const anonymous = await createUser(db, "b@example.com");
    const result = await db.query<{ id: string; display_name: string | null }>(
      "select id, display_name from public.profiles where id in ($1, $2)",
      [named, anonymous],
    );
    const byId = Object.fromEntries(result.rows.map((r) => [r.id, r.display_name]));
    expect(byId).toEqual({ [named]: "Ana", [anonymous]: null });
  });

  it("rejects a non-positive USD to DOP rate", async () => {
    await expect(
      db.query("update public.profiles set usd_to_dop_rate = 0 where id = $1", [userId]),
    ).rejects.toThrow(/check constraint/);
    await db.query("update public.profiles set usd_to_dop_rate = 60.5 where id = $1", [userId]);
  });

  it("refreshes updated_at on update", async () => {
    await db.query("update public.profiles set updated_at = '2020-01-01T00:00:00Z' where id = $1", [
      userId,
    ]);
    const result = await db.query<{ updated_at: Date }>(
      "select updated_at from public.profiles where id = $1",
      [userId],
    );
    expect(result.rows[0].updated_at.getUTCFullYear()).toBeGreaterThan(2020);
  });
});

describe("transactions", () => {
  it("stores a parsed purchase with defaults", async () => {
    const result = await insertTx(userId);
    expect(result.rows[0]).toMatchObject({ amount: "5986.90", ignored: false, kind: "consumo" });
  });

  it("deduplicates by Gmail message id per user", async () => {
    await insertTx(userId);
    await expect(insertTx(userId)).rejects.toThrow(/transactions_user_gmail_message_unique/);

    const other = await createUser(db, "other@example.com");
    await expect(insertTx(other)).resolves.toBeDefined();
  });

  it("allows several manual entries without a Gmail message id", async () => {
    await insertTx(userId, { gmail_message_id: null, source: "manual" });
    await insertTx(userId, { gmail_message_id: null, source: "manual" });
    const result = await db.query<{ n: number }>(
      "select count(*)::int as n from public.transactions where user_id = $1",
      [userId],
    );
    expect(result.rows[0].n).toBe(2);
  });

  it("requires a Gmail message id for Gmail imports", async () => {
    await expect(insertTx(userId, { gmail_message_id: null })).rejects.toThrow(
      /transactions_gmail_has_message_id/,
    );
  });

  it.each<[string, TxOverrides]>([
    ["unknown bank", { bank: "BHD" }],
    ["unknown currency", { currency: "EUR" }],
    ["unknown category", { category: "Varios" }],
    ["full card number", { card_last4: "4111111111111111" }],
    ["non-digit card", { card_last4: "73a1" }],
    ["zero amount", { amount: 0 }],
    ["negative amount", { amount: -5 }],
    ["bad month", { month: "2026-13" }],
    ["blank merchant", { merchant: "   " }],
    ["unknown source", { source: "csv" }],
  ])("rejects %s", async (_label, overrides) => {
    await expect(insertTx(userId, overrides)).rejects.toThrow(/check constraint/);
  });

  it("rounds amounts to 2 decimals", async () => {
    const result = await insertTx(userId, { amount: 920.005 });
    expect(result.rows[0].amount).toBe("920.01");
  });

  it("is deleted with its user", async () => {
    await insertTx(userId);
    await db.query("delete from auth.users where id = $1", [userId]);
    const result = await db.query<{ n: number }>(
      "select count(*)::int as n from public.transactions",
    );
    expect(result.rows[0].n).toBe(0);
  });
});

describe("gmail_connections", () => {
  const insert = (owner: string, token: string, historyId: string | null = "12345") =>
    db.query(
      `insert into public.gmail_connections (user_id, email, refresh_token_encrypted, last_history_id)
       values ($1, 'satoru@gmail.com', $2, $3)`,
      [owner, token, historyId],
    );

  it("allows one connection per user", async () => {
    await insert(userId, "iv:tag:ciphertext");
    await expect(insert(userId, "iv:tag:other")).rejects.toThrow(/duplicate key/);
  });

  it("rejects an empty token and a non-numeric history id", async () => {
    await expect(insert(userId, "")).rejects.toThrow(/check constraint/);
    await expect(insert(userId, "iv:tag:ciphertext", "abc")).rejects.toThrow(/check constraint/);
  });
});

describe("category_rules", () => {
  const insert = (keyword: string, category = "Supermercado") =>
    db.query("insert into public.category_rules (user_id, keyword, category) values ($1, $2, $3)", [
      userId,
      keyword,
      category,
    ]);

  it("keeps one rule per keyword per user, ignoring case and outer spaces", async () => {
    await insert("La Sirena");
    await expect(insert("  LA SIRENA ")).rejects.toThrow(/duplicate key/);
  });

  it("rejects blank keywords and unknown categories", async () => {
    await expect(insert("  ")).rejects.toThrow(/check constraint/);
    await expect(insert("COLMADO", "Colmados")).rejects.toThrow(/check constraint/);
  });
});

describe("sync_runs", () => {
  it("starts as a running manual run with zero counters", async () => {
    const result = await db.query<Record<string, unknown>>(
      `insert into public.sync_runs (user_id) values ($1)
       returning trigger, status, messages_seen, new_transactions, unparsed, errors`,
      [userId],
    );
    expect(result.rows[0]).toEqual({
      trigger: "manual",
      status: "running",
      messages_seen: 0,
      new_transactions: 0,
      unparsed: 0,
      errors: [],
    });
  });

  it("rejects a finish before the start and non-array errors", async () => {
    await expect(
      db.query(
        `insert into public.sync_runs (user_id, started_at, finished_at)
         values ($1, '2026-10-07T10:00:00Z', '2026-10-07T09:59:00Z')`,
        [userId],
      ),
    ).rejects.toThrow(/sync_runs_finished_after_start/);
    await expect(
      db.query(`insert into public.sync_runs (user_id, errors) values ($1, '{}'::jsonb)`, [userId]),
    ).rejects.toThrow(/check constraint/);
  });
});
