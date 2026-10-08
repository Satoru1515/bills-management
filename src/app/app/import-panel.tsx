"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SETTINGS_PATH } from "@/lib/dashboard/url";
import { formatMonthLabel, shiftMonth } from "@/lib/domain/month";
import { estimateImportMs, formatDuration, type ImportProgress } from "@/lib/sync/import-progress";
import type { ImportStepResult } from "@/lib/sync/import-queue";

interface ImportPanelProps {
  /** The queue as the page was rendered. */
  initial: ImportProgress;
  /** The current month, `YYYY-MM`: the latest that can be picked. */
  currentMonth: string;
  /** The oldest month that can be picked. */
  minMonth: string;
}

type Phase = "idle" | "working" | "waiting" | "reconnect" | "error";

/** Pause between steps while months are left, and after a "busy" answer. */
const NEXT_STEP_MS = 1000;
const BUSY_RETRY_MS = 10_000;

function isStepResult(body: unknown): body is ImportStepResult {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.progress === "object" && Array.isArray(b.processed);
}

function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * "Email history": imports the last months of Gmail one month at a time (the queue in
 * src/lib/sync/import-queue.ts) with a progress bar. When Gmail's per-minute limit is
 * reached it shows a countdown and continues by itself. More months can be added after a
 * notice with the estimated time.
 */
export function ImportPanel({ initial, currentMonth, minMonth }: ImportPanelProps) {
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [from, setFrom] = useState(
    initial.oldestMonth ? shiftMonth(initial.oldestMonth, -6) : shiftMonth(currentMonth, -11),
  );
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  /** Months the user asked for, sent with the next step. */
  const pendingFrom = useRef<string | null>(null);

  const schedule = useCallback((ms: number, run: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, ms);
  }, []);

  const step = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (timer.current) clearTimeout(timer.current);
    const from = pendingFrom.current;
    pendingFrom.current = null;
    setPhase("working");
    setWaitUntil(null);
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(from ? { from } : {}),
      });
      const json: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (!response.ok || !isStepResult(json)) {
        setPhase("error");
        return;
      }
      setProgress(json.progress);
      if (json.processed.length > 0) router.refresh();
      if (json.reconnectRequired) {
        setPhase("reconnect");
      } else if (json.busy) {
        setPhase("working");
        schedule(BUSY_RETRY_MS, () => void step());
      } else if (json.progress.active && json.waitMs !== null && json.waitMs > NEXT_STEP_MS) {
        setPhase("waiting");
        setWaitUntil(Date.now() + json.waitMs);
        schedule(json.waitMs, () => void step());
      } else if (json.progress.active) {
        schedule(NEXT_STEP_MS, () => void step());
      } else {
        setPhase("idle");
      }
    } catch {
      if (mounted.current) setPhase("error");
    } finally {
      inFlight.current = false;
      // Months asked for while this step ran go out right away.
      if (pendingFrom.current && mounted.current) schedule(0, () => void step());
    }
  }, [router, schedule]);

  // Start (or continue) the queue when the page opens: the first time it queues six months.
  useEffect(() => {
    mounted.current = true;
    if (initial.total === 0 || initial.active) void step();
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // Only on mount: later steps schedule themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick the countdown while waiting for Gmail.
  useEffect(() => {
    if (phase !== "waiting") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const done = new Set(progress.months.filter((m) => m.status === "done").map((m) => m.month));
  let newMonths = 0;
  for (let m = from; m <= currentMonth; m = shiftMonth(m, 1)) if (!done.has(m)) newMonths += 1;
  const validFrom = from >= minMonth && from <= currentMonth;

  function requestMonths(month: string) {
    setConfirming(false);
    pendingFrom.current = month;
    void step();
  }

  let status: string;
  if (phase === "reconnect") {
    status = "Gmail access expired. Reconnect Gmail in Settings to continue.";
  } else if (phase === "error") {
    status = "The import could not continue. Try again in a moment.";
  } else if (phase === "waiting" && waitUntil !== null) {
    status = `Waiting for Gmail's limit to reset · continues in ${countdown(waitUntil - now)}`;
  } else if (progress.running) {
    status = `Importing ${formatMonthLabel(progress.running)}…`;
  } else if (progress.active) {
    status = "Importing…";
  } else if (progress.total > 0) {
    status = `${progress.done} of ${progress.total} months imported · ${progress.newTransactions} purchases found`;
  } else {
    status = "Preparing the last six months…";
  }

  return (
    <section aria-labelledby="email-history" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="email-history" className="text-sm font-semibold">
          Email history
        </h3>
        <span className="text-xs text-muted tabular-nums">
          {progress.total > 0 &&
            `${progress.percent}% · ${progress.done + progress.failed} of ${progress.total} months`}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label="Email history import"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        className="h-2 w-full overflow-hidden rounded-full bg-border/70"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      <p
        role="status"
        className={`text-sm ${phase === "error" || phase === "reconnect" ? "text-red-600 dark:text-red-400" : "text-muted"}`}
      >
        {status}
        {phase === "reconnect" && (
          <>
            {" "}
            <Link href={SETTINGS_PATH} className="underline underline-offset-4">
              Open Settings
            </Link>
          </>
        )}
        {phase === "error" && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => void step()}
              className="underline underline-offset-4"
            >
              Try again
            </button>
          </>
        )}
      </p>

      {progress.failed > 0 && !progress.active && progress.oldestMonth && (
        <p className="text-sm text-muted">
          {progress.failed === 1
            ? "1 month could not be imported."
            : `${progress.failed} months could not be imported.`}{" "}
          <button
            type="button"
            onClick={() => requestMonths(progress.oldestMonth!)}
            className="underline underline-offset-4"
          >
            Retry them
          </button>
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (validFrom && newMonths > 0) setConfirming(true);
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <label className="flex flex-col gap-1 text-xs text-muted">
          Import more months, from
          <input
            type="month"
            required
            value={from}
            min={minMonth}
            max={currentMonth}
            onChange={(event) => {
              setFrom(event.target.value);
              setConfirming(false);
            }}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground tabular-nums"
          />
        </label>
        <button
          type="submit"
          disabled={!validFrom || newMonths === 0}
          className="h-9 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-accent-soft disabled:opacity-60"
        >
          Import
        </button>
      </form>

      {confirming && (
        <div
          role="alertdialog"
          aria-labelledby="import-estimate-title"
          aria-describedby="import-estimate-text"
          className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <p id="import-estimate-title" className="font-medium">
            Import {newMonths === 1 ? "1 more month" : `${newMonths} more months`}?
          </p>
          <p id="import-estimate-text" className="text-muted">
            This can take {formatDuration(estimateImportMs(newMonths))}: Gmail limits how fast
            emails can be read, so the app pauses between months. You can keep using the app; leave
            this page open to finish sooner. Otherwise it continues with the scheduled sync.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => requestMonths(from)}
              className="h-9 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-accent-soft disabled:opacity-60"
            >
              Start import
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-9 rounded-md px-3 text-sm text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
