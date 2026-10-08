/**
 * Data access for `public.transactions`.
 *
 * Every function takes the Supabase client and the user id, and always filters
 * by `user_id` itself: with the server client RLS also applies, but the admin
 * client used by the cron sync bypasses RLS.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isCategory } from "@/lib/domain/categorize";
import { isDay, shiftDay } from "@/lib/domain/day";
import {
  BANKS,
  CURRENCIES,
  type Category,
  type ParsedEmail,
  type Transaction,
  type TransactionKind,
  type TransactionSource,
} from "@/lib/domain/types";
import { formatDrIso, toDrParts } from "@/lib/parsers/shared";
import type { Database, Tables, TablesInsert } from "@/lib/supabase/database.types";

export type DbClient = SupabaseClient<Database>;

/** The columns selected by {@link COLUMNS}. */
export type TransactionRow = Omit<Tables<"transactions">, "created_at" | "updated_at">;

/** A parsed Gmail purchase ready to store, with the category the categorizer chose. */
export interface NewTransaction extends ParsedEmail {
  category: Category;
}

export interface UpsertResult {
  /** Transactions stored by this call. */
  inserted: Transaction[];
  /** Inputs not stored because their Gmail message was already saved (or repeated in the input). */
  skipped: number;
}

/** A database call failed or returned something the domain types do not allow. */
export class RepoError extends Error {
  readonly code: string | undefined;

  constructor(operation: string, message: string, code?: string) {
    super(`${operation}: ${message}`);
    this.name = "RepoError";
    this.code = code;
  }
}

/** Rows per upsert request, to keep request bodies small on a first full sync. */
export const UPSERT_CHUNK_SIZE = 500;

/** Rows per page when listing; PostgREST caps responses at 1000 rows by default. */
export const LIST_PAGE_SIZE = 1000;

/** Message ids per `in (...)` filter, so the request URL stays short. */
export const ID_FILTER_CHUNK_SIZE = 100;

const COLUMNS =
  "id, user_id, gmail_message_id, date, month, bank, card_last4, amount, currency, merchant, kind, category, ignored, source";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

interface DbError {
  message: string;
  code?: string;
}

/**
 * Stores new Gmail transactions. A message already saved for the user is left
 * untouched (`on conflict do nothing`), so a re-sync never overwrites the
 * `category` or `ignored` the user edited.
 */
export async function upsertMany(
  client: DbClient,
  userId: string,
  items: readonly NewTransaction[],
): Promise<UpsertResult> {
  const unique = uniqueByMessageId(items);
  const inserted: Transaction[] = [];

  for (let start = 0; start < unique.length; start += UPSERT_CHUNK_SIZE) {
    const rows = unique
      .slice(start, start + UPSERT_CHUNK_SIZE)
      .map((item) => toInsert(userId, item));
    const { data, error } = await client
      .from("transactions")
      .upsert(rows, { onConflict: "user_id,gmail_message_id", ignoreDuplicates: true })
      .select(COLUMNS);
    if (error) throw toRepoError("upsertMany", error);
    inserted.push(...(data ?? []).map(toTransaction));
  }

  return { inserted, skipped: items.length - inserted.length };
}

/** The subset of `gmailMessageIds` already stored as the user's transactions. */
export async function listStoredMessageIds(
  client: DbClient,
  userId: string,
  gmailMessageIds: readonly string[],
): Promise<Set<string>> {
  const unique = [...new Set(gmailMessageIds)];
  const stored = new Set<string>();
  for (let start = 0; start < unique.length; start += ID_FILTER_CHUNK_SIZE) {
    const { data, error } = await client
      .from("transactions")
      .select("gmail_message_id")
      .eq("user_id", userId)
      .in("gmail_message_id", unique.slice(start, start + ID_FILTER_CHUNK_SIZE));
    if (error) throw toRepoError("listStoredMessageIds", error);
    for (const row of data ?? []) if (row.gmail_message_id) stored.add(row.gmail_message_id);
  }
  return stored;
}

/** All of the user's transactions in a `YYYY-MM` month, newest first (ignored ones included). */
export async function listByMonth(
  client: DbClient,
  userId: string,
  month: string,
): Promise<Transaction[]> {
  if (!MONTH_RE.test(month)) {
    throw new RepoError("listByMonth", `invalid month "${month}", expected YYYY-MM`);
  }
  return listPaged("listByMonth", (page) => page.eq("month", month), client, userId);
}

/**
 * All of the user's transactions from day `from` to day `to` (`YYYY-MM-DD`, both included,
 * DR time), newest first (ignored ones included).
 */
export async function listBetween(
  client: DbClient,
  userId: string,
  from: string,
  to: string,
): Promise<Transaction[]> {
  if (!isDay(from) || !isDay(to) || from > to) {
    throw new RepoError("listBetween", `invalid range "${from}" to "${to}", expected YYYY-MM-DD`);
  }
  const start = `${from}T00:00:00-04:00`;
  const end = `${shiftDay(to, 1)}T00:00:00-04:00`;
  return listPaged(
    "listBetween",
    (page) => page.gte("date", start).lt("date", end),
    client,
    userId,
  );
}

type TransactionsFilter = ReturnType<ReturnType<DbClient["from"]>["select"]>;

async function listPaged(
  operation: string,
  filter: (query: TransactionsFilter) => TransactionsFilter,
  client: DbClient,
  userId: string,
): Promise<Transaction[]> {
  const result: Transaction[] = [];
  for (let from = 0; ; from += LIST_PAGE_SIZE) {
    const { data, error } = await filter(
      client.from("transactions").select(COLUMNS).eq("user_id", userId),
    )
      .order("date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + LIST_PAGE_SIZE - 1);
    if (error) throw toRepoError(operation, error);
    const page = (data ?? []) as TransactionRow[];
    result.push(...page.map(toTransaction));
    if (page.length < LIST_PAGE_SIZE) return result;
  }
}

/** Sets the category of one of the user's transactions. Returns null if it does not exist. */
export async function updateCategory(
  client: DbClient,
  userId: string,
  id: string,
  category: string,
): Promise<Transaction | null> {
  if (!isCategory(category)) {
    throw new RepoError("updateCategory", `unknown category "${category}"`);
  }
  return updateOne(client, userId, id, { category }, "updateCategory");
}

/** Hides a transaction from totals (`true`) or restores it (`false`). Returns null if it does not exist. */
export async function setIgnored(
  client: DbClient,
  userId: string,
  id: string,
  ignored: boolean,
): Promise<Transaction | null> {
  return updateOne(client, userId, id, { ignored }, "setIgnored");
}

async function updateOne(
  client: DbClient,
  userId: string,
  id: string,
  changes: { category?: Category; ignored?: boolean },
  operation: string,
): Promise<Transaction | null> {
  const { data, error } = await client
    .from("transactions")
    .update(changes)
    .eq("id", id)
    .eq("user_id", userId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw toRepoError(operation, error);
  return data ? toTransaction(data) : null;
}

/** First occurrence of each Gmail message id, in input order. */
function uniqueByMessageId(items: readonly NewTransaction[]): NewTransaction[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.gmailMessageId)) return false;
    seen.add(item.gmailMessageId);
    return true;
  });
}

function toInsert(userId: string, item: NewTransaction): TablesInsert<"transactions"> {
  return {
    user_id: userId,
    gmail_message_id: item.gmailMessageId,
    date: item.date,
    month: item.month,
    bank: item.bank,
    card_last4: item.cardLast4,
    amount: item.amount,
    currency: item.currency,
    merchant: item.merchant,
    kind: item.kind,
    category: item.category,
    source: "gmail",
  };
}

/** Maps a row to the domain type; the date comes back in UTC and is shown in DR time. */
export function toTransaction(row: TransactionRow): Transaction {
  const parts = toDrParts(row.date);
  const amount = Number(row.amount);
  if (!parts) throw invalidRow(row, "date", row.date);
  if (!Number.isFinite(amount)) throw invalidRow(row, "amount", String(row.amount));

  return {
    id: row.id,
    userId: row.user_id,
    gmailMessageId: row.gmail_message_id,
    date: formatDrIso(parts),
    month: row.month,
    bank: oneOf(row, "bank", BANKS),
    cardLast4: row.card_last4,
    amount,
    currency: oneOf(row, "currency", CURRENCIES),
    merchant: row.merchant,
    kind: oneOf(row, "kind", ["consumo"] as const satisfies readonly TransactionKind[]),
    category: isCategory(row.category) ? row.category : throwInvalid(row, "category"),
    ignored: row.ignored,
    source: oneOf(row, "source", [
      "gmail",
      "manual",
    ] as const satisfies readonly TransactionSource[]),
  };
}

function oneOf<K extends "bank" | "currency" | "kind" | "source", V extends string>(
  row: TransactionRow,
  key: K,
  allowed: readonly V[],
): V {
  const value = row[key];
  return (allowed as readonly string[]).includes(value) ? (value as V) : throwInvalid(row, key);
}

function throwInvalid(row: TransactionRow, key: keyof TransactionRow): never {
  throw invalidRow(row, key, String(row[key]));
}

function invalidRow(row: TransactionRow, key: string, value: string): RepoError {
  return new RepoError("toTransaction", `row ${row.id} has an invalid ${key} "${value}"`);
}

function toRepoError(operation: string, error: DbError): RepoError {
  return new RepoError(operation, error.message, error.code);
}
