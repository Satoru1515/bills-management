/**
 * "Import history" as a queue of months (`public.import_months`), so months of Gmail can be
 * read without tripping Gmail's per-user quota or the function time limit.
 *
 * Each step runs the newest month that is due, through the same pipeline as "Sync now" but
 * limited to that month and without moving `last_sync_at`. When Gmail says to slow down,
 * the month goes back to `pending` and the queue waits about a minute for the quota to
 * reset; that is not counted as a failed attempt. Real failures are retried later with
 * growing pauses, and a month that keeps failing is marked `failed`.
 *
 * Steps run while the dashboard is open (`POST /api/import`) and during the scheduled sync.
 * Server-only. Database and Gmail access are dependencies so the rules are tested without
 * a network.
 */

import { currentMonth, isMonth, shiftMonth } from "@/lib/domain/month";
import {
  claimImportMonth,
  finishImportMonth,
  listImportMonths,
  queueImportMonths,
  type ImportMonth,
  type ImportMonthUpdate,
} from "@/lib/repo/import-months";
import { hasRunningSync } from "@/lib/repo/sync-runs";
import type { DbClient } from "@/lib/repo/transactions";
import { summarizeImport, type ImportProgress } from "./import-progress";
import { isSameOrigin, runningSince, type JsonResponse } from "./requests";
import { createSyncDeps, runSync, type SyncOptions, type SyncResult } from "./run";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Months queued the first time (the current one and the five before it). */
export const DEFAULT_IMPORT_MONTHS = 6;
/** The oldest month that can be queued is this many months back, the current one included. */
export const MAX_IMPORT_MONTHS = 24;
/** A month that fails this many times is marked `failed`. */
export const MAX_IMPORT_ATTEMPTS = 5;
/** Pauses after a failed attempt (the last one repeats). */
export const IMPORT_RETRY_DELAYS_MS = [MINUTE_MS, 5 * MINUTE_MS, 15 * MINUTE_MS, 60 * MINUTE_MS];
/** Wait after Gmail's per-minute quota was hit: it is counted per minute. */
export const RATE_LIMIT_WAIT_MS = 65 * 1000;
/** A `running` month older than this was cut off (function timeout) and can be taken again. */
export const STALE_RUNNING_MS = 10 * MINUTE_MS;
/** A step starts no new month after running this long. */
export const STEP_BUDGET_MS = 20 * 1000;
/**
 * Gmail retries inside one import request: short, so a request ends well within the
 * function time limit; a longer wait is left to the queue ({@link RATE_LIMIT_WAIT_MS}).
 */
export const IMPORT_GMAIL_RETRY_DELAYS_MS = [2000, 5000] as const;

const MAX_ERROR_LENGTH = 200;

/** The months from `from` to the current one, oldest first (null if `from` is not allowed). */
export function monthsFrom(from: unknown, now: Date): string[] | null {
  const current = currentMonth(now);
  if (typeof from !== "string" || !isMonth(from) || from > current) return null;
  if (from < shiftMonth(current, 1 - MAX_IMPORT_MONTHS)) return null;
  const months: string[] = [];
  for (let m = from; m <= current; m = shiftMonth(m, 1)) months.push(m);
  return months;
}

/**
 * The Gmail search window of a month: from the day before it starts to the day after it
 * ends, because Gmail compares whole days. Messages outside the month are deduplicated or
 * stored under their own month as usual.
 */
export function importWindow(month: string): Required<Pick<SyncOptions, "since" | "until">> {
  const start = Date.parse(`${month}-01T00:00:00-04:00`);
  const end = Date.parse(`${shiftMonth(month, 1)}-01T00:00:00-04:00`);
  return {
    since: new Date(start - DAY_MS).toISOString(),
    until: new Date(end + DAY_MS).toISOString(),
  };
}

/** Database access of the queue, scoped to one user. */
export interface ImportStore {
  list(userId: string): Promise<ImportMonth[]>;
  queue(userId: string, months: readonly string[], now: string): Promise<void>;
  claim(userId: string, month: ImportMonth, now: string, staleBefore: string): Promise<boolean>;
  finish(userId: string, id: string, update: ImportMonthUpdate, now: string): Promise<void>;
}

/** {@link ImportStore} over the repository, for the service-role client. */
export function createImportStore(admin: DbClient): ImportStore {
  return {
    list: (userId) => listImportMonths(admin, userId),
    queue: (userId, months, now) => queueImportMonths(admin, userId, months, now),
    claim: (userId, month, now, staleBefore) =>
      claimImportMonth(admin, userId, month.id, month.status, now, staleBefore),
    finish: (userId, id, update, now) => finishImportMonth(admin, userId, id, update, now),
  };
}

/**
 * Real dependencies: the queue and the sync on the service-role client, with short Gmail
 * retries. A month run never moves `last_sync_at`.
 */
export function createImportDeps(admin: DbClient): ImportDeps {
  return {
    store: createImportStore(admin),
    isSyncRunning: (userId) => hasRunningSync(admin, userId, runningSince(new Date())),
    runMonth: (userId, window) =>
      runSync(
        createSyncDeps(admin, { retryDelaysMs: IMPORT_GMAIL_RETRY_DELAYS_MS }),
        userId,
        "import",
        { ...window, updateLastSync: false },
      ),
  };
}

export interface ImportDeps {
  store: ImportStore;
  /** A `Sync now` or cron sync of the user is running (the queue waits for it). */
  isSyncRunning(userId: string): Promise<boolean>;
  /** Syncs one month's window without moving `last_sync_at`. */
  runMonth(userId: string, window: { since: string; until: string }): Promise<SyncResult>;
  now?: () => Date;
}

export interface ImportStepResult {
  progress: ImportProgress;
  /** Months run in this step, in order. */
  processed: string[];
  /** Another step or a sync is running; try again shortly. */
  busy: boolean;
  /** Gmail access no longer works; the user must reconnect before the queue continues. */
  reconnectRequired: boolean;
  /** How long until the next month is due, when nothing can run now; null otherwise. */
  waitMs: number | null;
}

function isDue(month: ImportMonth, now: Date, staleBefore: string): boolean {
  if (month.status === "pending" || month.status === "error") {
    return Date.parse(month.nextAttemptAt) <= now.getTime();
  }
  return month.status === "running" && Date.parse(month.updatedAt) < Date.parse(staleBefore);
}

function isFreshRunning(month: ImportMonth, staleBefore: string): boolean {
  return month.status === "running" && Date.parse(month.updatedAt) >= Date.parse(staleBefore);
}

/**
 * Runs the queue for a while: the first time it queues the default six months, then it
 * runs due months, newest first, until none is due or the step budget is used.
 */
export async function runImportStep(
  deps: ImportDeps,
  userId: string,
  budgetMs = STEP_BUDGET_MS,
): Promise<ImportStepResult> {
  const clock = deps.now ?? (() => new Date());
  const startedAt = clock().getTime();
  const processed: string[] = [];
  let busy = false;
  let reconnectRequired = false;
  let rateLimitedUntil: number | null = null;

  let months = await deps.store.list(userId);
  if (months.length === 0) {
    const defaults = monthsFrom(
      shiftMonth(currentMonth(clock()), 1 - DEFAULT_IMPORT_MONTHS),
      clock(),
    )!;
    await deps.store.queue(userId, defaults, clock().toISOString());
    months = await deps.store.list(userId);
  }

  if (await deps.isSyncRunning(userId)) {
    busy = true;
  } else {
    for (;;) {
      const now = clock();
      const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS).toISOString();
      if (months.some((m) => isFreshRunning(m, staleBefore))) {
        busy = processed.length === 0;
        break;
      }
      const next = months.find((m) => isDue(m, now, staleBefore));
      if (!next) break;
      if (!(await deps.store.claim(userId, next, now.toISOString(), staleBefore))) {
        busy = true;
        break;
      }

      const outcome = await runOne(deps, userId, next);
      await deps.store.finish(userId, next.id, outcome.update, clock().toISOString());
      processed.push(next.month);
      if (outcome.reconnectRequired) {
        reconnectRequired = true;
        break;
      }
      if (outcome.rateLimited) {
        rateLimitedUntil = Date.parse(outcome.update.nextAttemptAt);
        break;
      }
      if (clock().getTime() - startedAt >= budgetMs) break;
      months = await deps.store.list(userId);
    }
    months = await deps.store.list(userId);
  }

  const now = clock();
  const progress = summarizeImport(months, now);
  let waitMs: number | null = null;
  if (!busy && !reconnectRequired && progress.nextAttemptAt !== null) {
    waitMs = Math.max(0, Date.parse(progress.nextAttemptAt) - now.getTime());
  }
  if (rateLimitedUntil !== null) waitMs = Math.max(0, rateLimitedUntil - now.getTime());
  return { progress, processed, busy, reconnectRequired, waitMs };
}

interface Outcome {
  update: ImportMonthUpdate;
  rateLimited: boolean;
  reconnectRequired: boolean;
}

async function runOne(deps: ImportDeps, userId: string, month: ImportMonth): Promise<Outcome> {
  const clock = deps.now ?? (() => new Date());
  let result: SyncResult | null = null;
  let thrown: unknown = null;
  try {
    result = await deps.runMonth(userId, importWindow(month.month));
  } catch (error) {
    thrown = error;
  }
  const now = clock().getTime();
  const base = {
    messagesSeen: result?.messagesSeen ?? month.messagesSeen,
    newTransactions: month.newTransactions + (result?.newTransactions ?? 0),
  };

  if (result?.reconnectRequired) {
    return {
      update: {
        ...base,
        status: "pending",
        attempts: month.attempts,
        nextAttemptAt: new Date(now).toISOString(),
        lastError: "Gmail access expired. Reconnect Gmail in Settings.",
      },
      rateLimited: false,
      reconnectRequired: true,
    };
  }
  if (result?.rateLimited) {
    return {
      update: {
        ...base,
        status: "pending",
        attempts: month.attempts,
        nextAttemptAt: new Date(now + RATE_LIMIT_WAIT_MS).toISOString(),
        lastError: "Waiting for Gmail's per-minute limit to reset.",
      },
      rateLimited: true,
      reconnectRequired: false,
    };
  }

  const attempts = month.attempts + 1;
  if (result && result.status === "ok" && result.errors.length === 0) {
    return {
      update: {
        ...base,
        status: "done",
        attempts,
        nextAttemptAt: new Date(now).toISOString(),
        lastError: null,
      },
      rateLimited: false,
      reconnectRequired: false,
    };
  }

  const message =
    result?.errors[0]?.message ??
    (thrown instanceof Error ? thrown.message : thrown !== null ? String(thrown) : "Sync failed");
  const delay = IMPORT_RETRY_DELAYS_MS[Math.min(attempts - 1, IMPORT_RETRY_DELAYS_MS.length - 1)]!;
  return {
    update: {
      ...base,
      status: attempts >= MAX_IMPORT_ATTEMPTS ? "failed" : "error",
      attempts,
      nextAttemptAt: new Date(now + delay).toISOString(),
      lastError: message.slice(0, MAX_ERROR_LENGTH),
    },
    rateLimited: false,
    reconnectRequired: false,
  };
}

export interface ImportRequest {
  /** The request's `Origin` header. */
  origin: string | null;
  url: string;
  /** `from` in the JSON body (`YYYY-MM`): queue the months from it to now first. */
  from?: unknown;
}

export interface ImportRequestDeps {
  /** The signed-in user's id (validated with the Auth server), or null. */
  getUserId(): Promise<string | null>;
  queue(userId: string, months: readonly string[]): Promise<void>;
  step(userId: string): Promise<ImportStepResult>;
  now?: () => Date;
  log?: (message: string) => void;
}

export type ImportErrorCode = "forbidden" | "unauthorized" | "invalid_from" | "import_failed";

/**
 * `POST /api/import`: optionally queues months (`{ "from": "YYYY-MM" }`, at most
 * {@link MAX_IMPORT_MONTHS} back), then runs one step of the queue and returns the progress.
 */
export async function handleImportRequest(
  request: ImportRequest,
  deps: ImportRequestDeps,
): Promise<JsonResponse<ImportStepResult | { error: ImportErrorCode }>> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const fail = (status: number, error: ImportErrorCode) => ({ status, body: { error } });

  if (!isSameOrigin(request.origin, request.url)) return fail(403, "forbidden");
  let months: string[] | null = null;
  if (request.from !== undefined && request.from !== null) {
    months = monthsFrom(request.from, now());
    if (months === null) return fail(400, "invalid_from");
  }

  try {
    const userId = await deps.getUserId();
    if (!userId) return fail(401, "unauthorized");
    if (months) await deps.queue(userId, months);
    return { status: 200, body: await deps.step(userId) };
  } catch (error) {
    log(`import step failed: ${error instanceof Error ? error.message : String(error)}`);
    return fail(500, "import_failed");
  }
}
