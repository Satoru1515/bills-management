/**
 * How far the "Import history" queue has got, and how long more months may take. Safe to
 * import from browser code (no server dependencies).
 */

import type { ImportMonth, ImportMonthStatus } from "@/lib/repo/import-months";

export interface ImportProgress {
  /** Months in the queue. */
  total: number;
  done: number;
  /** Months that kept failing and were given up on. */
  failed: number;
  /** Months still to run (pending or waiting to retry). */
  waiting: number;
  /** The month being imported right now, if any. */
  running: string | null;
  /** Finished months (done or failed) out of the total, 0 to 100. */
  percent: number;
  /** Purchases added by the queue so far. */
  newTransactions: number;
  /** When the next waiting month is due (it may already be); null when none waits. */
  nextAttemptAt: string | null;
  /** Something is left to run. */
  active: boolean;
  /** The oldest month queued, `YYYY-MM`. */
  oldestMonth: string | null;
  /** Each month, newest first. */
  months: { month: string; status: ImportMonthStatus }[];
}

export function summarizeImport(months: readonly ImportMonth[], now: Date): ImportProgress {
  let done = 0;
  let failed = 0;
  let waiting = 0;
  let running: string | null = null;
  let newTransactions = 0;
  let nextAttemptAt: number | null = null;
  for (const month of months) {
    newTransactions += month.newTransactions;
    if (month.status === "done") done += 1;
    else if (month.status === "failed") failed += 1;
    else if (month.status === "running") running ??= month.month;
    else {
      waiting += 1;
      const at = Date.parse(month.nextAttemptAt);
      if (nextAttemptAt === null || at < nextAttemptAt) nextAttemptAt = at;
    }
  }
  const total = months.length;
  const sorted = [...months].sort((a, b) => b.month.localeCompare(a.month));
  return {
    total,
    done,
    failed,
    waiting,
    running,
    percent: total === 0 ? 0 : Math.floor(((done + failed) / total) * 100),
    newTransactions,
    nextAttemptAt:
      nextAttemptAt === null
        ? null
        : new Date(Math.max(nextAttemptAt, now.getTime())).toISOString(),
    active: waiting > 0 || running !== null,
    oldestMonth: sorted.at(-1)?.month ?? null,
    months: sorted.map(({ month, status }) => ({ month, status })),
  };
}

/**
 * Rough time one month takes, including waits for Gmail's per-minute quota. Used only for
 * the estimate shown before queuing more months.
 */
export const ESTIMATED_MS_PER_MONTH = 90 * 1000;

/** Rough time to import `months` months while the page stays open. */
export function estimateImportMs(months: number): number {
  return Math.max(0, months) * ESTIMATED_MS_PER_MONTH;
}

/** `about 9 minutes`, `about 1 hour 30 minutes`, `less than a minute`. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} hour${hours === 1 ? "" : "s"}`;
  return rest === 0 ? `about ${h}` : `about ${h} ${rest} minute${rest === 1 ? "" : "s"}`;
}
