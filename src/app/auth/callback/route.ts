import { NextResponse, type NextRequest } from "next/server";
import { handleAuthCallback } from "@/lib/auth/callback";
import { authCallbackDeps } from "@/lib/auth/callback-deps";
import { createClient } from "@/lib/supabase/server";

/** Supabase redirects here after Google sign-in (see src/lib/auth/callback.ts). */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const target = await handleAuthCallback(new URL(request.url), authCallbackDeps(supabase));
  return NextResponse.redirect(target);
}
