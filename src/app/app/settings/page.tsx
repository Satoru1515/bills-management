import Link from "next/link";
import { redirect } from "next/navigation";
import { GoogleSignInForm } from "@/app/login/google-sign-in-form";
import { LOGIN_PATH } from "@/lib/auth/redirect";
import { DASHBOARD_PATH, SETTINGS_PATH } from "@/lib/dashboard/url";
import { getGmailConnectionStatus } from "@/lib/repo/gmail-connections";
import { getUsdToDopRate } from "@/lib/repo/profiles";
import { getLatestSyncRun } from "@/lib/repo/sync-runs";
import {
  describeRun,
  formatDateTime,
  gmailStatus,
  type GmailStatusTone,
} from "@/lib/settings/gmail-status";
import { createClient } from "@/lib/supabase/server";
import { RateForm } from "./rate-form";

export const metadata = { title: "Settings · Bills Management" };

const TONES: Record<GmailStatusTone, string> = {
  ok: "bg-emerald-600 dark:bg-emerald-400",
  neutral: "bg-accent",
  warning: "bg-amber-500 dark:bg-amber-400",
  error: "bg-red-600 dark:bg-red-400",
};

const SECTION = "flex flex-col gap-3 rounded-lg border border-border bg-surface p-4";

/** Exchange rate, Gmail connection state, last sync and reconnect. */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The middleware already guards /app; this check is a second line.
  if (!user) redirect(LOGIN_PATH);

  const [rate, connection, run] = await Promise.all([
    getUsdToDopRate(supabase, user.id),
    getGmailConnectionStatus(supabase, user.id),
    getLatestSyncRun(supabase, user.id),
  ]);
  const status = gmailStatus(connection, run, new Date());
  const lastRun = describeRun(run);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-2xl font-semibold">Settings</h2>
        <Link href={DASHBOARD_PATH} className="text-sm text-accent underline underline-offset-4">
          Back to dashboard
        </Link>
      </div>

      <section aria-labelledby="settings-rate" className={SECTION}>
        <h3 id="settings-rate" className="text-sm font-semibold">
          Exchange rate
        </h3>
        <RateForm rate={rate} />
      </section>

      <section aria-labelledby="settings-gmail" className={SECTION}>
        <h3 id="settings-gmail" className="text-sm font-semibold">
          Gmail
        </h3>
        <p className="flex items-center gap-2 text-sm font-medium">
          <span aria-hidden="true" className={`size-2 rounded-full ${TONES[status.tone]}`} />
          {status.label}
        </p>
        <p className="text-sm text-muted">{status.detail}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Signed in as</dt>
          <dd className="break-all">{user.email ?? "—"}</dd>
          {connection && (
            <>
              <dt className="text-muted">Gmail account</dt>
              <dd className="break-all">{connection.email}</dd>
              <dt className="text-muted">Connected</dt>
              <dd className="tabular-nums">{formatDateTime(connection.connectedAt)}</dd>
              <dt className="text-muted">Last successful sync</dt>
              <dd className="tabular-nums">
                {connection.lastSyncAt ? formatDateTime(connection.lastSyncAt) : "Never"}
              </dd>
            </>
          )}
        </dl>
        {lastRun && <p className="text-xs text-muted tabular-nums">{lastRun}</p>}
        <GoogleSignInForm className="flex flex-col items-start gap-1">
          <input type="hidden" name="next" value={SETTINGS_PATH} />
          <button
            type="submit"
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              status.suggestReconnect
                ? "bg-foreground text-background"
                : "border border-border hover:bg-accent-soft"
            }`}
          >
            {connection ? "Reconnect Gmail" : "Connect Gmail"}
          </button>
          <span className="text-xs text-muted">
            Signs in with Google again and asks for read-only Gmail access.
          </span>
        </GoogleSignInForm>
      </section>
    </>
  );
}
