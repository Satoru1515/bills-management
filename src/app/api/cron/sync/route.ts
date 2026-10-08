import { NextResponse, type NextRequest } from "next/server";
import { listConnectedUserIds } from "@/lib/repo/gmail-connections";
import { hasRunningSync } from "@/lib/repo/sync-runs";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleCronSync } from "@/lib/sync/requests";
import { createSyncDeps, runSync } from "@/lib/sync/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron (vercel.json) calls this every 15 minutes with `Authorization: Bearer
 * $CRON_SECRET`; it syncs every user with Gmail connected (see src/lib/sync/requests.ts).
 */
export async function GET(request: NextRequest) {
  const { status, body } = await handleCronSync(
    request.headers.get("authorization"),
    process.env.CRON_SECRET,
    {
      listConnectedUserIds: () => listConnectedUserIds(createAdminClient()),
      isSyncRunning: (userId, since) => hasRunningSync(createAdminClient(), userId, since),
      runSync: (userId) => runSync(createSyncDeps(createAdminClient()), userId, "cron"),
      log: (message) => console.error(message),
    },
  );

  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
