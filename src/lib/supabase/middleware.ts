import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath, loginUrl } from "@/lib/auth/redirect";
import type { Database } from "./database.types";
import { supabasePublicEnv } from "./env";

/**
 * Runs on every page request (see src/middleware.ts): refreshes the Supabase
 * session cookies and sends signed-out visitors of `/app/*` to `/login`.
 *
 * `getUser()` asks the Auth server to validate the session, so a forged or
 * expired cookie never counts as signed in.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { url, anonKey } = supabasePublicEnv();
  let response = NextResponse.next({ request });
  // No-cache headers that must travel with any auth cookie write.
  let cookieHeaders: Record<string, string> = {};

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        cookieHeaders = { ...cookieHeaders, ...headers };
        for (const [name, value] of Object.entries(cookieHeaders)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  // Nothing may run between creating the client and getUser(): the session
  // refresh it triggers is what writes the new cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  if (!user && isProtectedPath(pathname)) {
    const redirect = NextResponse.redirect(
      loginUrl(request.nextUrl.origin, `${pathname}${search}`),
    );
    // Keep any cookie changes (for example a cleared, invalid session).
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    for (const [name, value] of Object.entries(cookieHeaders)) {
      redirect.headers.set(name, value);
    }
    return redirect;
  }

  return response;
}
