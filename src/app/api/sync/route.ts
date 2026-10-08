import { NextResponse, type NextRequest } from "next/server";
import { hasRunningSync } from "@/lib/repo/sync-runs";
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

  const { status, body } = await handleManualSync(
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
      runSync: (userId) => runSync(createSyncDeps(createAdminClient()), userId, "manual"),
      log: (message) => console.error(message),
    },
  );

  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
