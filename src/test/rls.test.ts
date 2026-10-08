// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createMigratedDb, createUser } from "./pglite";

const TABLES = [
  "profiles",
  "gmail_connections",
  "transactions",
  "category_rules",
  "sync_runs",
  "import_months",
];

let db: PGlite;
let ana: string;
let ben: string;
let anaTx: string;
let benTx: string;

const count = async (
  tx: Pick<PGlite, "query">,
  table: string,
  where = "true",
  params: unknown[] = [],
) =>
  (
    await tx.query<{ n: number }>(
      `select count(*)::int as n from public.${table} where ${where}`,
      params,
    )
  ).rows[0].n;

async function seedUser(email: string, name: string) {
  const id = await createUser(db, email, { full_name: name });
  const tx = await db.query<{ id: string }>(
    `insert into public.transactions
       (user_id, gmail_message_id, date, month, bank, card_last4, amount, currency, merchant)
     values ($1, 'msg-1', '2026-10-04T19:35:00-04:00', '2026-10', 'APAP', '5977', 920, 'DOP',
             'BURGER KING SAN ISIDRO')
     returning id`,
    [id],
  );
  await db.query(
    `insert into public.gmail_connections (user_id, email, refresh_token_encrypted)
     values ($1, $2, 'iv:tag:ciphertext')`,
    [id, email],
  );
  await db.query(
    "insert into public.category_rules (user_id, keyword, category) values ($1, 'COLMADO', 'Supermercado')",
    [id],
  );
  await db.query("insert into public.sync_runs (user_id) values ($1)", [id]);
  await db.query("insert into public.import_months (user_id, month) values ($1, '2026-05')", [id]);
  return { id, txId: tx.rows[0].id };
}

beforeAll(async () => {
  db = await createMigratedDb();
  ({ id: ana, txId: anaTx } = await seedUser("ana@example.com", "Ana"));
  ({ id: ben, txId: benTx } = await seedUser("ben@example.com", "Ben"));
}, 30_000);

afterAll(async () => {
  await db.close();
});

describe("RLS policies", () => {
  it("has policies only for the authenticated role", async () => {
    const result = await db.query<{ tablename: string; roles: string[] | string }>(
      "select tablename, roles::text[] as roles from pg_policies where schemaname = 'public'",
    );
    expect(new Set(result.rows.map((r) => r.tablename))).toEqual(new Set(TABLES));
    for (const row of result.rows) expect(row.roles).toEqual(["authenticated"]);
  });

  it.each(TABLES.filter((t) => t !== "gmail_connections"))(
    "anon sees no rows in %s",
    async (table) => {
      expect(await asUser(db, null, (tx) => count(tx, table))).toBe(0);
    },
  );

  it("anon cannot read gmail_connections at all", async () => {
    await expect(asUser(db, null, (tx) => count(tx, "gmail_connections"))).rejects.toThrow(
      /permission denied/,
    );
  });

  it.each(TABLES)("a user sees only their own rows in %s", async (table) => {
    const owner = table === "profiles" ? "id" : "user_id";
    const seen = await asUser(db, ana, async (tx) => ({
      all: await count(tx, table),
      mine: await count(tx, table, `${owner} = $1`, [ana]),
    }));
    expect(seen).toEqual({ all: 1, mine: 1 });
  });

  it("anon cannot insert", async () => {
    await expect(
      asUser(db, null, (tx) =>
        tx.query(
          "insert into public.category_rules (user_id, keyword, category) values ($1, 'X', 'Otros')",
          [ana],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("transactions", () => {
  it("a user can edit category and ignored on their own transaction", async () => {
    const updated = await asUser(db, ana, async (tx) => {
      const result = await tx.query(
        "update public.transactions set category = 'Restaurantes', ignored = true where id = $1",
        [anaTx],
      );
      return result.affectedRows;
    });
    expect(updated).toBe(1);
  });

  it("updates and deletes on another user's transaction affect nothing", async () => {
    const affected = await asUser(db, ana, async (tx) => {
      const update = await tx.query("update public.transactions set ignored = true where id = $1", [
        benTx,
      ]);
      const remove = await tx.query("delete from public.transactions where id = $1", [benTx]);
      return [update.affectedRows, remove.affectedRows];
    });
    expect(affected).toEqual([0, 0]);
    expect(await count(db, "transactions", "id = $1 and not ignored", [benTx])).toBe(1);
  });

  it("a user cannot insert a transaction for someone else", async () => {
    await expect(
      asUser(db, ana, (tx) =>
        tx.query(
          `insert into public.transactions
             (user_id, gmail_message_id, date, month, bank, card_last4, amount, currency, merchant)
           values ($1, 'msg-2', now(), '2026-10', 'APAP', '5977', 10, 'DOP', 'X')`,
          [ben],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a user cannot move their transaction to another user", async () => {
    await expect(
      asUser(db, ana, (tx) =>
        tx.query("update public.transactions set user_id = $1 where id = $2", [ben, anaTx]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a user can insert and delete their own manual transaction", async () => {
    const result = await asUser(db, ana, async (tx) => {
      await tx.query(
        `insert into public.transactions
           (user_id, date, month, bank, card_last4, amount, currency, merchant, source)
         values ($1, now(), '2026-10', 'PayPal', '0000', 11.99, 'USD', 'Spotify AB', 'manual')`,
        [ana],
      );
      const before = await count(tx, "transactions");
      const removed = await tx.query("delete from public.transactions where source = 'manual'");
      return [before, removed.affectedRows];
    });
    expect(result).toEqual([2, 1]);
  });
});

describe("profiles", () => {
  it("a user can update their own profile but not another one", async () => {
    const affected = await asUser(db, ana, async (tx) => {
      const own = await tx.query(
        "update public.profiles set usd_to_dop_rate = 60.5 where id = $1",
        [ana],
      );
      const other = await tx.query("update public.profiles set usd_to_dop_rate = 1 where id = $1", [
        ben,
      ]);
      return [own.affectedRows, other.affectedRows];
    });
    expect(affected).toEqual([1, 0]);
  });

  it("a user cannot create or delete profiles", async () => {
    await expect(
      asUser(db, ana, (tx) =>
        tx.query("insert into public.profiles (id) values (gen_random_uuid())"),
      ),
    ).rejects.toThrow(/row-level security/);
    const removed = await asUser(
      db,
      ana,
      async (tx) =>
        (await tx.query("delete from public.profiles where id = $1", [ana])).affectedRows,
    );
    expect(removed).toBe(0);
  });
});

describe("gmail_connections", () => {
  it("never exposes the encrypted refresh token through the API", async () => {
    await expect(
      asUser(db, ana, (tx) =>
        tx.query("select refresh_token_encrypted from public.gmail_connections"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ana, (tx) => tx.query("select * from public.gmail_connections")),
    ).rejects.toThrow(/permission denied/);
  });

  it("lets a user read the connection status columns", async () => {
    const rows = await asUser(
      db,
      ana,
      async (tx) =>
        (
          await tx.query<{ email: string }>(
            "select email, last_sync_at from public.gmail_connections",
          )
        ).rows,
    );
    expect(rows).toEqual([{ email: "ana@example.com", last_sync_at: null }]);
  });

  it("lets a user replace their own token and sync cursor", async () => {
    const affected = await asUser(db, ana, async (tx) => {
      const result = await tx.query(
        `update public.gmail_connections
            set refresh_token_encrypted = 'iv:tag:new', last_history_id = '999', last_sync_at = now()
          where user_id = $1`,
        [ana],
      );
      return result.affectedRows;
    });
    expect(affected).toBe(1);
  });

  it("lets a user reconnect (delete and insert their own row) but not someone else's", async () => {
    const result = await asUser(db, ana, async (tx) => {
      const removedOther = await tx.query(
        "delete from public.gmail_connections where user_id = $1",
        [ben],
      );
      const removedOwn = await tx.query("delete from public.gmail_connections where user_id = $1", [
        ana,
      ]);
      await tx.query(
        `insert into public.gmail_connections (user_id, email, refresh_token_encrypted)
         values ($1, 'ana@example.com', 'iv:tag:again')`,
        [ana],
      );
      return [removedOther.affectedRows, removedOwn.affectedRows];
    });
    expect(result).toEqual([0, 1]);
  });

  it("a user cannot store a connection for someone else", async () => {
    await db.query("delete from public.gmail_connections where user_id = $1", [ben]);
    try {
      await expect(
        asUser(db, ana, (tx) =>
          tx.query(
            `insert into public.gmail_connections (user_id, email, refresh_token_encrypted)
             values ($1, 'ben@example.com', 'iv:tag:x')`,
            [ben],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await db.query(
        `insert into public.gmail_connections (user_id, email, refresh_token_encrypted)
         values ($1, 'ben@example.com', 'iv:tag:ciphertext')`,
        [ben],
      );
    }
  });
});

describe("category_rules", () => {
  it("a user manages only their own rules", async () => {
    const result = await asUser(db, ana, async (tx) => {
      await tx.query(
        "insert into public.category_rules (user_id, keyword, category) values ($1, 'LA CASA', 'Hogar')",
        [ana],
      );
      const updatedOther = await tx.query(
        "update public.category_rules set category = 'Otros' where user_id = $1",
        [ben],
      );
      const deletedOwn = await tx.query("delete from public.category_rules where user_id = $1", [
        ana,
      ]);
      return [updatedOther.affectedRows, deletedOwn.affectedRows];
    });
    expect(result).toEqual([0, 2]);
  });
});

describe("sync_runs", () => {
  it("a user reads only their own runs", async () => {
    const rows = await asUser(
      db,
      ana,
      async (tx) =>
        (await tx.query<{ user_id: string }>("select user_id from public.sync_runs")).rows,
    );
    expect(rows).toEqual([{ user_id: ana }]);
  });

  // Only the server (service role) records syncs; the rows drive the "Sync now" rate limit.
  it.each([
    ["start", "insert into public.sync_runs (user_id) values ($1)"],
    [
      "rewrite",
      "update public.sync_runs set started_at = now() - interval '1 day' where user_id = $1",
    ],
    ["delete", "delete from public.sync_runs where user_id = $1"],
  ])("a user cannot %s runs, not even their own", async (_action, sql) => {
    await expect(asUser(db, ana, (tx) => tx.query(sql, [ana]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("the service role still records and finishes runs", async () => {
    const finished = await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.query("insert into public.sync_runs (user_id) values ($1)", [ana]);
      const result = await tx.query(
        `update public.sync_runs set status = 'ok', finished_at = now(), new_transactions = 3
          where user_id = $1 and status = 'running'`,
        [ana],
      );
      await tx.exec("delete from public.sync_runs where status = 'ok'");
      return result.affectedRows;
    });
    expect(finished).toBe(2);
    expect(await count(db, "sync_runs", "user_id = $1 and status = 'running'", [ben])).toBe(1);
  });
});

describe("import_months", () => {
  it("a user reads only their own queue", async () => {
    const rows = await asUser(
      db,
      ana,
      async (tx) =>
        (await tx.query<{ user_id: string }>("select user_id from public.import_months")).rows,
    );
    expect(rows).toEqual([{ user_id: ana }]);
  });

  // Only the server fills and works the queue.
  it.each([
    ["queue", "insert into public.import_months (user_id, month) values ($1, '2026-04')"],
    ["rewrite", "update public.import_months set status = 'done' where user_id = $1"],
    ["delete", "delete from public.import_months where user_id = $1"],
  ])("a user cannot %s months, not even their own", async (_action, sql) => {
    await expect(asUser(db, ana, (tx) => tx.query(sql, [ana]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("the service role still queues and completes months", async () => {
    const done = await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.query("insert into public.import_months (user_id, month) values ($1, '2026-04')", [
        ana,
      ]);
      const result = await tx.query(
        "update public.import_months set status = 'done' where user_id = $1",
        [ana],
      );
      await tx.exec("delete from public.import_months where month = '2026-04'");
      return result.affectedRows;
    });
    expect(done).toBe(2);
  });
});

describe("service role", () => {
  it("bypasses RLS for server-side sync", async () => {
    const n = await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      return count(tx, "transactions");
    });
    expect(n).toBe(2);
  });
});
