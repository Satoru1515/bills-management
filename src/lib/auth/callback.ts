/**
 * The OAuth callback: Google redirects to Supabase, Supabase redirects here
 * with `?code=`. The code is exchanged for a session (PKCE, cookies set by the
 * server client) and the Gmail refresh token on that session is stored.
 *
 * Dependencies are injected so the flow can be tested without a network.
 */

import type { ProviderSession, StoreTokenResult } from "./gmail-token";
import { loginUrl, safeNextPath, type LoginErrorCode } from "./redirect";

export interface CallbackDeps {
  exchangeCode: (
    code: string,
  ) => Promise<{ session: ProviderSession | null; error: { message: string } | null }>;
  storeToken: (session: ProviderSession) => Promise<StoreTokenResult>;
  log?: (message: string) => void;
}

/** Handles the callback request and returns where to redirect the browser. */
export async function handleAuthCallback(requestUrl: URL, deps: CallbackDeps): Promise<URL> {
  const { origin, searchParams } = requestUrl;
  const next = safeNextPath(searchParams.get("next"));
  const fail = (error: LoginErrorCode) => loginUrl(origin, next, error);
  const log = deps.log ?? (() => {});

  // Google or Supabase reports a refused consent or another provider error.
  const providerError = searchParams.get("error");
  if (providerError) {
    log(`auth callback: provider error ${providerError}`);
    return fail(providerError === "access_denied" ? "access_denied" : "exchange_failed");
  }

  const code = searchParams.get("code");
  if (!code) return fail("missing_code");

  const { session, error } = await deps.exchangeCode(code);
  if (error || !session) {
    log(`auth callback: code exchange failed: ${error?.message ?? "no session"}`);
    return fail("exchange_failed");
  }

  try {
    const result = await deps.storeToken(session);
    if (result === "missing") {
      log("auth callback: Google returned no refresh token; kept the existing Gmail connection");
    }
  } catch (storeError) {
    log(`auth callback: could not store the Gmail token: ${errorMessage(storeError)}`);
    return fail("gmail_token_failed");
  }

  return new URL(next, origin);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
