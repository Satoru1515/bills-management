/**
 * Rate limit of the "Sync now" button (`POST /api/sync`), counted from the user's own
 * `sync_runs` rows, so it holds across serverless instances without extra storage. Users can
 * only read those rows (migration 0003), so they cannot rewrite them to get around it.
 *
 * Each sync reads the user's Gmail and holds a function for up to a minute; the cron sync
 * already keeps the data fresh, so a manual sync is only needed now and then.
 */

/** Wait after the start of a manual sync before the next one. */
export const MANUAL_SYNC_COOLDOWN_MS = 60 * 1000;

/** Most manual syncs a user can start in any rolling window of this length. */
export const MANUAL_SYNC_WINDOW_MS = 60 * 60 * 1000;
export const MANUAL_SYNC_LIMIT_PER_WINDOW = 10;

/** Start of the window whose manual syncs count towards the limit. */
export function manualSyncWindowStart(now: Date): string {
  return new Date(now.getTime() - MANUAL_SYNC_WINDOW_MS).toISOString();
}

/**
 * Seconds the user must wait before another manual sync, or null when one may start now.
 * `startedAt` holds the start times (ISO 8601) of the user's recent manual syncs, in any
 * order; unreadable values and syncs outside the window are ignored.
 */
export function manualSyncRetryAfter(startedAt: readonly string[], now: Date): number | null {
  const nowMs = now.getTime();
  const starts = startedAt
    .map((value) => Date.parse(value))
    .filter((ms) => Number.isFinite(ms) && ms > nowMs - MANUAL_SYNC_WINDOW_MS)
    .sort((a, b) => b - a);

  let waitMs = 0;
  if (starts.length > 0) {
    waitMs = Math.max(waitMs, starts[0] + MANUAL_SYNC_COOLDOWN_MS - nowMs);
  }
  if (starts.length >= MANUAL_SYNC_LIMIT_PER_WINDOW) {
    // Free again once the oldest of the latest `limit` syncs leaves the window.
    const oldestCounted = starts[MANUAL_SYNC_LIMIT_PER_WINDOW - 1];
    waitMs = Math.max(waitMs, oldestCounted + MANUAL_SYNC_WINDOW_MS - nowMs);
  }
  // A start time in the future (clock skew) is capped by the window, never longer.
  waitMs = Math.min(waitMs, MANUAL_SYNC_WINDOW_MS);
  return waitMs > 0 ? Math.ceil(waitMs / 1000) : null;
}
