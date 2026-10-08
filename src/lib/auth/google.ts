/**
 * Google sign-in through Supabase Auth, asking for read-only Gmail access.
 *
 * `access_type=offline` makes Google return a refresh token, and
 * `prompt=consent` makes it return one on every sign-in (Google only sends it
 * on the first consent otherwise). Supabase hands that token to the app once,
 * as `session.provider_refresh_token` from `exchangeCodeForSession`; see
 * `storeGmailTokenFromSession` in ./gmail-token.ts.
 */

import type { SignInWithOAuthCredentials, SupabaseClient } from "@supabase/supabase-js";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/**
 * Scopes requested on top of the ones Supabase always asks Google for
 * (`email profile openid`), space-separated as `signInWithOAuth` expects.
 */
export const GOOGLE_EXTRA_SCOPES = GMAIL_READONLY_SCOPE;

/** Scopes the stored Gmail connection was granted, saved in `gmail_connections.scope`. */
export const GOOGLE_GRANTED_SCOPES = `openid email profile ${GMAIL_READONLY_SCOPE}`;

/** `signInWithOAuth` credentials for Google with offline Gmail read-only access. */
export function googleSignInOptions(redirectTo: string): SignInWithOAuthCredentials {
  return {
    provider: "google",
    options: {
      redirectTo,
      scopes: GOOGLE_EXTRA_SCOPES,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  };
}

/**
 * Starts the Google sign-in and returns the URL of Google's consent screen.
 * In the browser, Supabase also navigates there by itself.
 */
export async function signInWithGoogle(
  client: Pick<SupabaseClient, "auth">,
  redirectTo: string,
): Promise<string> {
  const { data, error } = await client.auth.signInWithOAuth(googleSignInOptions(redirectTo));
  if (error) {
    throw new Error(`Google sign-in failed: ${error.message}`);
  }
  if (!data.url) {
    throw new Error("Google sign-in failed: Supabase returned no redirect URL");
  }
  return data.url;
}
