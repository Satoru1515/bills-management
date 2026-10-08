/**
 * Supabase settings read from the environment (see .env.example).
 *
 * The NEXT_PUBLIC_* variables are read with literal `process.env.NAME`
 * expressions so Next.js can inline them into the browser bundle.
 */

export interface SupabasePublicEnv {
  url: string;
  anonKey: string;
}

/** URL and anon key, available in the browser and on the server. */
export function supabasePublicEnv(): SupabasePublicEnv {
  return {
    url: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };
}

/** Server-only key that bypasses RLS. Never import this from browser code. */
export function supabaseServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing environment variable ${name}; copy .env.example to .env.local.`);
  }
  return trimmed;
}
