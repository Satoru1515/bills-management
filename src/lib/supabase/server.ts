import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { supabasePublicEnv } from "./env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers,
 * acting as the signed-in user (anon key + session cookies, so RLS applies).
 * Create a new one per request; never share it between requests.
 */
export async function createClient() {
  const { url, anonKey } = supabasePublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The session is refreshed by
          // the middleware (Fase 3), so the write can be skipped here.
        }
      },
    },
  });
}
