/**
 * The JSON that `POST /api/sync` returns and the message the "Sync now" button shows for it.
 * Safe to import from browser code (no server dependencies).
 */

/** Body of a `200` from `POST /api/sync`: the outcome of the run, without error details. */
export interface SyncResponseBody {
  status: "ok" | "error";
  finishedAt: string;
  messagesSeen: number;
  newTransactions: number;
  unparsed: number;
  duplicates: number;
  /** Errors recorded in `sync_runs` (details stay in the database). */
  errorCount: number;
  /** The user must sign in with Google again. */
  reconnectRequired: boolean;
}

/** Error codes in the body of a non-200 response: `{ error: SyncErrorCode }`. */
export type SyncErrorCode = "forbidden" | "unauthorized" | "sync_in_progress" | "sync_failed";

export interface SyncFeedback {
  tone: "success" | "error";
  message: string;
}

const RETRY_LATER = "The sync failed. Please try again later.";

/** What to tell the user after `POST /api/sync` answered with `status` and `body`. */
export function syncFeedback(status: number, body: unknown): SyncFeedback {
  if (status === 401) return error("Your session has ended. Sign in again.");
  if (status === 409) return error("A sync is already running. Try again in a minute.");
  if (status !== 200 || !isSyncResponseBody(body)) return error(RETRY_LATER);

  if (body.status === "error") {
    return error(
      body.reconnectRequired
        ? "Gmail access has expired or was revoked. Sign out and sign in with Google again."
        : RETRY_LATER,
    );
  }

  const parts = [
    body.newTransactions === 0
      ? "Up to date: no new purchases."
      : `Added ${plural(body.newTransactions, "new purchase")}.`,
  ];
  if (body.unparsed > 0) {
    parts.push(`${plural(body.unparsed, "email")} from your banks could not be read.`);
  }
  if (body.errorCount > 0) {
    parts.push("Some emails could not be loaded; they will be retried on the next sync.");
  }
  return { tone: "success", message: parts.join(" ") };
}

function error(message: string): SyncFeedback {
  return { tone: "error", message };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function isSyncResponseBody(body: unknown): body is SyncResponseBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    (b.status === "ok" || b.status === "error") &&
    typeof b.newTransactions === "number" &&
    typeof b.unparsed === "number" &&
    typeof b.errorCount === "number" &&
    typeof b.reconnectRequired === "boolean"
  );
}
