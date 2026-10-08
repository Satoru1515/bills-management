import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { supabasePublicEnv, supabaseServiceRoleKey } from "./env";

/**
 * Supabase client with the service role key: it bypasses RLS and can read
 * `gmail_connections.refresh_token_encrypted`. Server-only (cron sync, token
 * storage). Every query made with it must filter by `user_id` itself.
 */
export function createAdminClient() {
  const { url } = supabasePublicEnv();
  return createClient<Database>(url, supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
