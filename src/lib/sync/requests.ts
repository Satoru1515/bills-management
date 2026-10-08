/**
 * The two ways a sync starts: `POST /api/sync` (the signed-in user's "Sync now" button) and
 * `GET /api/cron/sync` (Vercel Cron, every user with Gmail connected). Server-only.
 *
 * The route handlers in src/app/api only wire these to Supabase and `runSync`, so the request
 * rules (who may sync, one run at a time, what the response says) are tested without a network.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { SyncErrorCode, SyncResponseBody } from "./feedback";
import type { SyncResult } from "./run";

/**
 * A `running` sync younger than this blocks a new one for the same user. Older ones were cut
 * off (the functions time out well before this) and no longer count.
 */
export const RUNNING_SYNC_WINDOW_MS = 10 * 60 * 1000;

export interface JsonResponse<T = unknown> {
  status: number;
  body: T;
}

/** The parts of a sync result the browser sees (error details stay in `sync_runs`). */
export function toResponseBody(result: SyncResult): SyncResponseBody {
  return {
    status: result.status,
    finishedAt: result.finishedAt,
    messagesSeen: result.messagesSeen,
    newTransactions: result.newTransactions,
    unparsed: result.unparsed,
    duplicates: result.duplicates,
    errorCount: result.errors.length,
    reconnectRequired: result.reconnectRequired,
  };
}

/** Start of the window in which a `running` sync still blocks a new one. */
export function runningSince(now: Date): string {
  return new Date(now.getTime() - RUNNING_SYNC_WINDOW_MS).toISOString();
}

/**
 * Whether a browser request comes from this site. Browsers always send `Origin` on a `POST`
 * from `fetch`; a request without one (curl, server code) is allowed, since it still needs the
 * user's session cookie.
 */
export function isSameOrigin(originHeader: string | null, requestUrl: string): boolean {
  if (originHeader === null) return true;
  try {
    return new URL(originHeader).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

export interface ManualSyncRequest {
  /** The request's `Origin` header. */
  origin: string | null;
  url: string;
}

export interface ManualSyncDeps {
  /** The signed-in user's id (validated with the Auth server), or null. */
  getUserId(): Promise<string | null>;
  isSyncRunning(userId: string, since: string): Promise<boolean>;
  runSync(userId: string): Promise<SyncResult>;
  now?: () => Date;
  log?: (message: string) => void;
}

/** `POST /api/sync`: syncs the signed-in user's Gmail now. */
export async function handleManualSync(
  request: ManualSyncRequest,
  deps: ManualSyncDeps,
): Promise<JsonResponse<SyncResponseBody | { error: SyncErrorCode }>> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const fail = (status: number, error: SyncErrorCode) => ({ status, body: { error } });

  if (!isSameOrigin(request.origin, request.url)) return fail(403, "forbidden");

  try {
    const userId = await deps.getUserId();
    if (!userId) return fail(401, "unauthorized");
    if (await deps.isSyncRunning(userId, runningSince(now()))) {
      return fail(409, "sync_in_progress");
    }
    const result = await deps.runSync(userId);
    return { status: 200, body: toResponseBody(result) };
  } catch (error) {
    log(`manual sync failed: ${errorMessage(error)}`);
    return fail(500, "sync_failed");
  }
}

/**
 * Whether `Authorization` is `Bearer <CRON_SECRET>` (what Vercel Cron sends). Never true when
 * the secret is not configured. Compares digests so the time taken reveals nothing.
 */
export function isCronAuthorized(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  const expected = secret?.trim();
  if (!expected || authorization === null) return false;
  return timingSafeEqual(digest(authorization), digest(`Bearer ${expected}`));
}

export interface CronSyncDeps {
  listConnectedUserIds(): Promise<string[]>;
  isSyncRunning(userId: string, since: string): Promise<boolean>;
  runSync(userId: string): Promise<SyncResult>;
  now?: () => Date;
  log?: (message: string) => void;
}

/** Totals of one cron run. Holds no user data, so it is safe to return to the caller. */
export interface CronSyncSummary {
  users: number;
  /** Runs that finished with status `ok`. */
  ok: number;
  /** Runs that finished with status `error`, or threw. */
  failed: number;
  /** Users skipped because a sync of theirs was already running. */
  skipped: number;
  /** Users whose Google grant no longer works (they must sign in again). */
  reconnectRequired: number;
  newTransactions: number;
}

/**
 * Syncs every connected user, one after another, so one user's failure never stops the rest.
 * Only a failure to list the users throws.
 */
export async function runCronSync(deps: CronSyncDeps): Promise<CronSyncSummary> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const userIds = await deps.listConnectedUserIds();
  const summary: CronSyncSummary = {
    users: userIds.length,
    ok: 0,
    failed: 0,
    skipped: 0,
    reconnectRequired: 0,
    newTransactions: 0,
  };

  for (const userId of userIds) {
    try {
      if (await deps.isSyncRunning(userId, runningSince(now()))) {
        summary.skipped += 1;
        continue;
      }
      const result = await deps.runSync(userId);
      summary.newTransactions += result.newTransactions;
      if (result.reconnectRequired) summary.reconnectRequired += 1;
      if (result.status === "ok") summary.ok += 1;
      else summary.failed += 1;
    } catch (error) {
      summary.failed += 1;
      log(`cron sync failed for user ${userId}: ${errorMessage(error)}`);
    }
  }
  return summary;
}

/** `GET /api/cron/sync`: checks the cron secret, then syncs every connected user. */
export async function handleCronSync(
  authorization: string | null,
  secret: string | undefined,
  deps: CronSyncDeps,
): Promise<JsonResponse<CronSyncSummary | { error: string }>> {
  const log = deps.log ?? (() => {});
  if (!secret?.trim()) {
    log("cron sync refused: CRON_SECRET is not set");
    return { status: 500, body: { error: "cron_not_configured" } };
  }
  if (!isCronAuthorized(authorization, secret)) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  try {
    return { status: 200, body: await runCronSync(deps) };
  } catch (error) {
    log(`cron sync failed: ${errorMessage(error)}`);
    return { status: 500, body: { error: "sync_failed" } };
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
