/**
 * Saves the Gmail refresh token that Google returned with the sign-in.
 *
 * Supabase does not store provider tokens: `provider_refresh_token` is only
 * present on the session returned by `exchangeCodeForSession` in the auth
 * callback, so it must be saved right there.
 */

import type { Session } from "@supabase/supabase-js";
import { saveGmailConnection } from "@/lib/repo/gmail-connections";
import type { DbClient } from "@/lib/repo/transactions";
import { GOOGLE_GRANTED_SCOPES } from "./google";

/** The session fields this module reads. */
export type ProviderSession = Pick<Session, "provider_refresh_token"> & {
  user: Pick<Session["user"], "id" | "email">;
};

/**
 * - `stored`: the token was encrypted and saved.
 * - `missing`: Google sent no refresh token (consent was not shown again);
 *   any connection saved before is left as it was.
 */
export type StoreTokenResult = "stored" | "missing";

export async function storeGmailTokenFromSession(
  admin: DbClient,
  session: ProviderSession,
  key: Buffer,
): Promise<StoreTokenResult> {
  const refreshToken = session.provider_refresh_token;
  if (!refreshToken) return "missing";

  const email = session.user.email;
  if (!email) {
    throw new Error("Google returned no email address for this account");
  }

  await saveGmailConnection(
    admin,
    { userId: session.user.id, email, refreshToken, scope: GOOGLE_GRANTED_SCOPES },
    key,
  );
  return "stored";
}
