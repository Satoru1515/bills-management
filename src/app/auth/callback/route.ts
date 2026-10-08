import { NextResponse, type NextRequest } from "next/server";
import { handleAuthCallback } from "@/lib/auth/callback";
import { storeGmailTokenFromSession } from "@/lib/auth/gmail-token";
import { encryptionKey } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Supabase redirects here after Google sign-in (see src/lib/auth/callback.ts). */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const target = await handleAuthCallback(new URL(request.url), {
    async exchangeCode(code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      return { session: data.session, error };
    },
    storeToken: (session) =>
      storeGmailTokenFromSession(createAdminClient(), session, encryptionKey()),
    log: (message) => console.error(message),
  });

  return NextResponse.redirect(target);
}
