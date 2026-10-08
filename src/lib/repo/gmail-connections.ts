/**
 * Data access for `public.gmail_connections`.
 *
 * The refresh token is stored encrypted (AES-256-GCM, see src/lib/crypto.ts)
 * with the user id bound as context. Only the admin (service role) client can
 * read `refresh_token_encrypted`: RLS column grants hide it from users.
 */

import { decrypt, encrypt } from "@/lib/crypto";
import { RepoError, type DbClient } from "./transactions";

export interface GmailConnectionInput {
  userId: string;
  /** The Gmail address the token belongs to. */
  email: string;
  /** Plain refresh token from Google; encrypted before it leaves this function. */
  refreshToken: string;
  /** Space-separated OAuth scopes granted with the token. */
  scope: string | null;
}

/**
 * Creates or replaces the user's Gmail connection with a new refresh token.
 * Sync state (`last_history_id`, `last_sync_at`) is kept on reconnect, since a
 * user always signs in with the same Google account.
 */
export async function saveGmailConnection(
  admin: DbClient,
  input: GmailConnectionInput,
  key: Buffer,
): Promise<void> {
  const email = input.email.trim();
  if (!input.userId) throw new RepoError("saveGmailConnection", "missing user id");
  if (!email) throw new RepoError("saveGmailConnection", "missing Gmail address");
  if (!input.refreshToken) throw new RepoError("saveGmailConnection", "missing refresh token");

  const { error } = await admin.from("gmail_connections").upsert(
    {
      user_id: input.userId,
      email,
      refresh_token_encrypted: encrypt(input.refreshToken, key, input.userId),
      scope: input.scope,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new RepoError("saveGmailConnection", error.message, error.code);
}

/** The user's decrypted refresh token, or null if Gmail is not connected. */
export async function getRefreshToken(
  admin: DbClient,
  userId: string,
  key: Buffer,
): Promise<string | null> {
  const { data, error } = await admin
    .from("gmail_connections")
    .select("refresh_token_encrypted")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new RepoError("getRefreshToken", error.message, error.code);
  if (!data) return null;
  return decrypt(data.refresh_token_encrypted, key, userId);
}
