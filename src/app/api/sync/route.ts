import { NextResponse, type NextRequest } from "next/server";
import { hasRunningSync, listSyncStartsSince } from "@/lib/repo/sync-runs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { handleManualSync } from "@/lib/sync/requests";
import { createSyncDeps, runSync } from "@/lib/sync/run";

export const dynamic = "force-dynamic";
// A first sync reads up to 90 days of alerts.
export const maxDuration = 60;

/** "Sync now": syncs the signed-in user's Gmail (see src/lib/sync/requests.ts). */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { status, body, headers } = await handleManualSync(
    { origin: request.headers.get("origin"), url: request.url },
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
      runSync: (userId) => runSync(createSyncDeps(createAdminClient()), userId, "manual"),
      log: (message) => console.error(message),
    },
  );

  return NextResponse.json(body, {
    status,
    headers: { ...headers, "Cache-Control": "no-store" },
  });
}
