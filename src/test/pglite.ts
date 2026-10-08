/**
 * Test helper: an in-memory Postgres (PGlite) with the parts of Supabase the
 * migrations depend on (the `auth` schema, `auth.uid()` and the API roles),
 * followed by every file in supabase/migrations in order.
 *
 * Only for tests that run in the `node` environment.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

export const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Minimal stand-in for what Supabase provides before user migrations run. */
const SUPABASE_STUB = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  -- Same lookup order as Supabase's auth.uid().
  create function auth.uid() returns uuid
  language sql stable
  as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on functions to anon, authenticated, service_role;
`;

/** Migration file names in the order Supabase applies them. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** A fresh database with the Supabase stub and all migrations applied. */
export async function createMigratedDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

/**
 * Runs `fn` inside a transaction as the API would: role `authenticated` with
 * the user's id as the JWT `sub`, or role `anon` when `userId` is null.
 * The transaction is always rolled back, so writes made here do not persist.
 */
export async function asUser<T>(
  db: PGlite,
  userId: string | null,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  await db
    .transaction(async (tx) => {
      await tx.exec(`set local role ${userId ? "authenticated" : "anon"}`);
      if (userId) {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: userId, role: "authenticated" }),
        ]);
      }
      result = await fn(tx);
      await tx.rollback();
    })
    .catch((error: unknown) => {
      if (!isRollback(error)) throw error;
    });
  return result as T;
}

/** PGlite rejects the transaction promise after an explicit rollback; that is expected here. */
function isRollback(error: unknown): boolean {
  return error instanceof Error && /rollback/i.test(error.message);
}

/** Inserts an auth user (which fires the profile trigger) and returns its id. */
export async function createUser(
  db: PGlite,
  email: string,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify(metadata)],
  );
  return result.rows[0].id;
}
