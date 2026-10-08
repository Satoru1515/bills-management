/**
 * The Gmail connection summary on the settings page, from the stored connection and the
 * latest sync run. Pure: the current time is passed in.
 */

import { GMAIL_READONLY_SCOPE } from "@/lib/auth/google";
import { formatDayTime } from "@/lib/domain/month";
import { toDrParts } from "@/lib/parsers/shared";
import type { GmailConnectionStatus } from "@/lib/repo/gmail-connections";
import type { SyncRunRecord } from "@/lib/repo/sync-runs";
import { RUNNING_SYNC_WINDOW_MS } from "@/lib/sync/requests";

export type GmailStatusTone = "ok" | "neutral" | "warning" | "error";

export interface GmailStatus {
  tone: GmailStatusTone;
  label: string;
  detail: string;
  /** Whether the page should ask the user to reconnect (or connect) Gmail. */
  suggestReconnect: boolean;
}

/** `2026-10-07T19:00:00Z` → `Oct 7, 2026, 3:00 PM` (DR time); the input as is if unparseable. */
export function formatDateTime(iso: string): string {
  const when = formatDayTime(iso);
  const parts = toDrParts(iso);
  return when && parts ? `${when.day}, ${parts.year}, ${when.time}` : iso;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** One line about the latest sync run, or null if none ever started. */
export function describeRun(run: SyncRunRecord | null): string | null {
  if (!run) return null;
  const how = run.trigger === "cron" ? "automatic" : "manual";
  const when = formatDateTime(run.finishedAt ?? run.startedAt);
  if (run.status === "running") {
    return `${how === "automatic" ? "An" : "A"} ${how} sync started ${when}.`;
  }
  if (run.status === "error") return `The last ${how} sync failed (${when}).`;
  const parts = [`Last ${how} sync ${when}: ${plural(run.newTransactions, "new purchase")}`];
  if (run.unparsed > 0) parts.push(`${plural(run.unparsed, "email")} not read`);
  if (run.errorCount > 0) parts.push(`${plural(run.errorCount, "error")}`);
  return `${parts.join(", ")}.`;
}

export function gmailStatus(
  connection: GmailConnectionStatus | null,
  run: SyncRunRecord | null,
  now: Date,
): GmailStatus {
  if (!connection) {
    return {
      tone: "warning",
      label: "Not connected",
      detail: "Connect Gmail so the app can read your card alerts.",
      suggestReconnect: true,
    };
  }

  const scopes = (connection.scope ?? "").split(/\s+/);
  if (connection.scope !== null && !scopes.includes(GMAIL_READONLY_SCOPE)) {
    return {
      tone: "error",
      label: "Gmail access missing",
      detail: "Google did not grant read access to Gmail. Reconnect and allow it.",
      suggestReconnect: true,
    };
  }

  const running =
    run?.status === "running" && now.getTime() - Date.parse(run.startedAt) < RUNNING_SYNC_WINDOW_MS;
  if (running) {
    return {
      tone: "neutral",
      label: "Syncing",
      detail: "A sync is running now.",
      suggestReconnect: false,
    };
  }

  if (run?.status === "error") {
    return {
      tone: "error",
      label: "Last sync failed",
      detail:
        "If Gmail access expired or was revoked, reconnect below. Otherwise the next sync will try again.",
      suggestReconnect: true,
    };
  }

  if (connection.lastSyncAt === null) {
    return {
      tone: "neutral",
      label: "Connected, not synced yet",
      detail: "Use Sync now on the dashboard to read your alerts for the first time.",
      suggestReconnect: false,
    };
  }

  return {
    tone: "ok",
    label: "Connected",
    detail: "New alerts are read automatically.",
    suggestReconnect: false,
  };
}
