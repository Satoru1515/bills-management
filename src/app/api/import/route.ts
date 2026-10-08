import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createImportDeps, handleImportRequest, runImportStep } from "@/lib/sync/import-queue";

export const dynamic = "force-dynamic";
// One step runs months for about 20 seconds; a slow month can take longer.
export const maxDuration = 60;

/**
 * "Import history": the dashboard calls this repeatedly while the queue has months left,
 * with `{ "from": "YYYY-MM" }` when the user asks for more months
 * (see src/lib/sync/import-queue.ts).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const payload: unknown = await request.json().catch(() => null);
  const from =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>).from
      : undefined;

  const { status, body } = await handleImportRequest(
    { origin: request.headers.get("origin"), url: request.url, from },
    {
      async getUserId() {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        return user?.id ?? null;
      },
      queue: (userId, months) =>
        createImportDeps(createAdminClient()).store.queue(userId, months, new Date().toISOString()),
      step: (userId) => runImportStep(createImportDeps(createAdminClient()), userId),
      log: (message) => console.error(message),
    },
  );

  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
