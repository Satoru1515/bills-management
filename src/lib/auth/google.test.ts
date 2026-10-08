import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  GMAIL_READONLY_SCOPE,
  GOOGLE_GRANTED_SCOPES,
  googleSignInOptions,
  signInWithGoogle,
} from "./google";

const REDIRECT = "http://localhost:3000/auth/callback";

function fakeAuth(result: { data: { url: string | null }; error: { message: string } | null }) {
  const signInWithOAuth = vi.fn().mockResolvedValue(result);
  const client = { auth: { signInWithOAuth } } as unknown as Pick<SupabaseClient, "auth">;
  return { client, signInWithOAuth };
}

describe("googleSignInOptions", () => {
  it("asks Google for offline, read-only Gmail access with forced consent", () => {
    expect(googleSignInOptions(REDIRECT)).toEqual({
      provider: "google",
      options: {
        redirectTo: REDIRECT,
        scopes: "https://www.googleapis.com/auth/gmail.readonly",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  });

  it("never requests more than read-only Gmail access", () => {
    const scopes = googleSignInOptions(REDIRECT).options?.scopes ?? "";
    for (const scope of scopes.split(" ")) {
      expect(scope).not.toMatch(/gmail\.(modify|send|compose|insert|labels)|mail\.google\.com/);
    }
    expect(GOOGLE_GRANTED_SCOPES.split(" ")).toContain(GMAIL_READONLY_SCOPE);
  });
});

describe("signInWithGoogle", () => {
  it("returns Google's consent URL", async () => {
    const { client, signInWithOAuth } = fakeAuth({
      data: { url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" },
      error: null,
    });
    await expect(signInWithGoogle(client, REDIRECT)).resolves.toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?x=1",
    );
    expect(signInWithOAuth).toHaveBeenCalledWith(googleSignInOptions(REDIRECT));
  });

  it("throws the Supabase error", async () => {
    const { client } = fakeAuth({ data: { url: null }, error: { message: "provider disabled" } });
    await expect(signInWithGoogle(client, REDIRECT)).rejects.toThrow(
      "Google sign-in failed: provider disabled",
    );
  });

  it("throws when there is no URL", async () => {
    const { client } = fakeAuth({ data: { url: null }, error: null });
    await expect(signInWithGoogle(client, REDIRECT)).rejects.toThrow(/no redirect URL/);
  });
});
