import { encryptionKey } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import type { CallbackDeps } from "./callback";
import { storeGmailTokenFromSession } from "./gmail-token";

/**
 * The real dependencies of `handleAuthCallback`: the code is exchanged with the
 * user's server client (which sets the session cookies) and the Gmail token is
 * saved with the admin client. Shared by /auth/callback and the app's sign-in.
 */
export function authCallbackDeps(supabase: Awaited<ReturnType<typeof createClient>>): CallbackDeps {
  return {
    async exchangeCode(code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      return { session: data.session, error };
    },
    storeToken: (session) =>
      storeGmailTokenFromSession(createAdminClient(), session, encryptionKey()),
    log: (message) => console.error(message),
  };
}
