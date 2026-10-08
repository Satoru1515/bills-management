import { NextResponse, type NextRequest } from "next/server";
import { hasRunningSync, listSyncStartsSince } from "@/lib/repo/sync-runs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { handleManualSync } from "@/lib/sync/requests";
import { createSyncDeps, runSync } from "@/lib/sync/run";

export const dynamic = "force-dynamic";
// A first sync, or "Import history", can read months of alerts.
export const maxDuration = 300;

/**
 * "Sync now", or "Import history" with a JSON body `{ "since": "YYYY-MM-DD" }`: syncs the
 * signed-in user's Gmail (see src/lib/sync/requests.ts).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const payload: unknown = await request.json().catch(() => null);
  const since =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>).since
      : undefined;

  const { status, body, headers } = await handleManualSync(
    { origin: request.headers.get("origin"), url: request.url, since },
    {
      async getUserId() {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        return user?.id ?? null;
      },
      // The user's own client: RLS lets them read their sync_runs.
      isSyncRunning: (userId, since) => hasRunningSync(supabase, userId, since),
      // Users can read but not write sync_runs (migration 0003), so the count is trustworthy.
      listManualSyncStarts: (userId, since) =>
        listSyncStartsSince(supabase, userId, "manual", since),
      runSync: (userId, options) =>
        runSync(createSyncDeps(createAdminClient()), userId, "manual", options),
      log: (message) => console.error(message),
    },
  );

  return NextResponse.json(body, {
    status,
    headers: { ...headers, "Cache-Control": "no-store" },
  });
}
