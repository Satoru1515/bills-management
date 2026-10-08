"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { syncFeedback, type SyncFeedback } from "@/lib/sync/feedback";

interface HistoryImportProps {
  /** Day the date input starts on, `YYYY-MM-DD`. */
  defaultSince: string;
  /** Earliest day that can be picked. */
  minSince: string;
  /** Latest day that can be picked (today). */
  maxSince: string;
}

/**
 * "Import history": syncs Gmail from a chosen day (`POST /api/sync` with `{ since }`), for
 * purchases older than the first sync reached. Already stored purchases are not duplicated.
 */
export function HistoryImport({ defaultSince, minSince, maxSince }: HistoryImportProps) {
  const router = useRouter();
  const [since, setSince] = useState(defaultSince);
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<SyncFeedback | null>(null);

  async function importHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunning(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since }),
      });
      const body: unknown = await response.json().catch(() => null);
      setFeedback(syncFeedback(response.status, body));
      if (response.ok) router.refresh();
    } catch {
      setFeedback({ tone: "error", message: "Could not reach the server. Check your connection." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <form onSubmit={importHistory} className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Import emails since
          <input
            type="date"
            required
            value={since}
            min={minSince}
            max={maxSince}
            onChange={(event) => setSince(event.target.value)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground tabular-nums"
          />
        </label>
        <button
          type="submit"
          disabled={running || since === ""}
          aria-busy={running}
          className="h-9 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-accent-soft disabled:opacity-60"
        >
          {running ? "Importing…" : "Import history"}
        </button>
      </div>
      <p
        role="status"
        className={`text-sm ${feedback?.tone === "error" ? "text-red-600 dark:text-red-400" : "text-muted"}`}
      >
        {feedback?.message}
      </p>
    </form>
  );
}
