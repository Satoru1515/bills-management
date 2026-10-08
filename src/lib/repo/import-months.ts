/**
 * Data access for `public.import_months`: the queue of months to import from Gmail
 * (see src/lib/sync/import-queue.ts). Users can only read it; the server writes it with the
 * service-role client, so every function filters by `user_id` itself.
 */

import { RepoError, type DbClient } from "./transactions";

export type ImportMonthStatus = "pending" | "running" | "done" | "error" | "failed";

const STATUSES: readonly string[] = ["pending", "running", "done", "error", "failed"];

export interface ImportMonth {
  id: string;
  /** `YYYY-MM`. */
  month: string;
  status: ImportMonthStatus;
  attempts: number;
  nextAttemptAt: string;
  messagesSeen: number;
  newTransactions: number;
  lastError: string | null;
  updatedAt: string;
}

const COLUMNS =
  "id, month, status, attempts, next_attempt_at, messages_seen, new_transactions, last_error, updated_at";

interface ImportMonthRow {
  id: string;
  month: string;
  status: string;
  attempts: number;
  next_attempt_at: string;
  messages_seen: number;
  new_transactions: number;
  last_error: string | null;
  updated_at: string;
}

function toImportMonth(row: ImportMonthRow): ImportMonth {
  if (!STATUSES.includes(row.status)) {
    throw new RepoError("import_months", `invalid status "${row.status}"`);
  }
  return {
    id: row.id,
    month: row.month,
    status: row.status as ImportMonthStatus,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    messagesSeen: row.messages_seen,
    newTransactions: row.new_transactions,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

/** The user's queue, newest month first. */
export async function listImportMonths(client: DbClient, userId: string): Promise<ImportMonth[]> {
  const { data, error } = await client
    .from("import_months")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("month", { ascending: false });
  if (error) throw new RepoError("listImportMonths", error.message, error.code);
  return (data ?? []).map(toImportMonth);
}

/**
 * Adds months to the queue as `pending`. Months already queued keep their state, except
 * failed or erroring ones, which start over (the user asked for them again).
 */
export async function queueImportMonths(
  client: DbClient,
  userId: string,
  months: readonly string[],
  now: string,
): Promise<void> {
  if (months.length === 0) return;
  const { error } = await client.from("import_months").upsert(
    months.map((month) => ({ user_id: userId, month, next_attempt_at: now })),
    { onConflict: "user_id,month", ignoreDuplicates: true },
  );
  if (error) throw new RepoError("queueImportMonths", error.message, error.code);

  const { error: resetError } = await client
    .from("import_months")
    .update({
      status: "pending",
      attempts: 0,
      next_attempt_at: now,
      last_error: null,
      updated_at: now,
    })
    .eq("user_id", userId)
    .in("month", [...months])
    .in("status", ["error", "failed"]);
  if (resetError) throw new RepoError("queueImportMonths", resetError.message, resetError.code);
}

/**
 * Marks a month `running` if it is still in `from` (and, for a `running` month left behind
 * by a cut-off run, older than `staleBefore`). False when another request took it first.
 */
export async function claimImportMonth(
  client: DbClient,
  userId: string,
  id: string,
  from: ImportMonthStatus,
  now: string,
  staleBefore: string,
): Promise<boolean> {
  let query = client
    .from("import_months")
    .update({ status: "running", updated_at: now })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", from);
  if (from === "running") query = query.lt("updated_at", staleBefore);
  const { data, error } = await query.select("id");
  if (error) throw new RepoError("claimImportMonth", error.message, error.code);
  return (data ?? []).length > 0;
}

export interface ImportMonthUpdate {
  status: ImportMonthStatus;
  attempts: number;
  nextAttemptAt: string;
  messagesSeen: number;
  newTransactions: number;
  lastError: string | null;
}

/** Stores the outcome of running one month. */
export async function finishImportMonth(
  client: DbClient,
  userId: string,
  id: string,
  update: ImportMonthUpdate,
  now: string,
): Promise<void> {
  const { error } = await client
    .from("import_months")
    .update({
      status: update.status,
      attempts: update.attempts,
      next_attempt_at: update.nextAttemptAt,
      messages_seen: update.messagesSeen,
      new_transactions: update.newTransactions,
      last_error: update.lastError,
      updated_at: now,
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new RepoError("finishImportMonth", error.message, error.code);
}
