"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { syncFeedback, type SyncFeedback } from "@/lib/sync/feedback";

/** "Sync now": runs `POST /api/sync` and shows what it found. */
export function SyncButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<SyncFeedback | null>(null);

  async function sync() {
    setRunning(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const body: unknown = await response.json().catch(() => null);
      setFeedback(syncFeedback(response.status, body));
      // Show the new purchases on the page.
      if (response.ok) router.refresh();
    } catch {
      setFeedback({ tone: "error", message: "Could not reach the server. Check your connection." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={sync}
        disabled={running}
        aria-busy={running}
        className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-accent-soft disabled:opacity-60"
      >
        {running ? "Syncing…" : "Sync now"}
      </button>
      <p
        role="status"
        className={`text-sm ${feedback?.tone === "error" ? "text-red-600 dark:text-red-400" : "text-muted"}`}
      >
        {feedback?.message}
      </p>
    </div>
  );
}
