import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { supabasePublicEnv } from "./env";

/**
 * Supabase client for Client Components. Uses the anon key and the session
 * cookies set by the server, so every query runs under the user's RLS policies.
 * `createBrowserClient` returns the same instance on repeated calls.
 */
export function createClient() {
  const { url, anonKey } = supabasePublicEnv();
  return createBrowserClient<Database>(url, anonKey);
}
