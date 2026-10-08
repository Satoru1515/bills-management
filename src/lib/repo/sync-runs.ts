/**
 * Data access for `public.sync_runs`: one row per Gmail sync, created as `running` when it
 * starts and completed with its counts and errors when it ends.
 */

import { RepoError, type DbClient } from "./transactions";

export type SyncTrigger = "manual" | "cron";
export type SyncRunStatus = "ok" | "error";

/** One problem found during a sync, stored in `sync_runs.errors`. */
export interface SyncRunError {
  /** The Gmail message involved, or null for errors not tied to one message. */
  gmailMessageId: string | null;
  message: string;
}

export interface SyncRunSummary {
  status: SyncRunStatus;
  finishedAt: string;
  messagesSeen: number;
  newTransactions: number;
  unparsed: number;
  errors: readonly SyncRunError[];
}

/** Creates the `running` row of a sync and returns its id. */
export async function startSyncRun(
  client: DbClient,
  userId: string,
  trigger: SyncTrigger,
  startedAt: string,
): Promise<string> {
  const { data, error } = await client
    .from("sync_runs")
    .insert({ user_id: userId, trigger, status: "running", started_at: startedAt })
    .select("id")
    .single();
  if (error) throw new RepoError("startSyncRun", error.message, error.code);
  if (!data) throw new RepoError("startSyncRun", "no row returned");
  return data.id;
}

/** Completes a sync row with its result. */
export async function finishSyncRun(
  client: DbClient,
  userId: string,
  runId: string,
  summary: SyncRunSummary,
): Promise<void> {
  const { error } = await client
    .from("sync_runs")
    .update({
      status: summary.status,
      finished_at: summary.finishedAt,
      messages_seen: summary.messagesSeen,
      new_transactions: summary.newTransactions,
      unparsed: summary.unparsed,
      errors: summary.errors.map(({ gmailMessageId, message }) => ({ gmailMessageId, message })),
    })
    .eq("id", runId)
    .eq("user_id", userId);
  if (error) throw new RepoError("finishSyncRun", error.message, error.code);
}

/**
 * Whether the user has a `running` sync that started at or after `since`. Older `running`
 * rows are runs that were cut off (for example by a function timeout) and do not count.
 */
export async function hasRunningSync(
  client: DbClient,
  userId: string,
  since: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("sync_runs")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "running")
    .gte("started_at", since)
    .limit(1);
  if (error) throw new RepoError("hasRunningSync", error.message, error.code);
  return (data ?? []).length > 0;
}
