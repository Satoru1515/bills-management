import { describe, expect, it } from "vitest";
import { decrypt } from "@/lib/crypto";
import { argsOf, createSupabaseMock } from "@/test/supabase-mock";
import { GOOGLE_GRANTED_SCOPES } from "./google";
import { storeGmailTokenFromSession, type ProviderSession } from "./gmail-token";

// Test-only key; never a real secret.
const KEY = Buffer.alloc(32, 5);
const USER = "11111111-1111-4111-8111-111111111111";

function session(overrides: Partial<ProviderSession> = {}): ProviderSession {
  return {
    provider_refresh_token: "1//0test-refresh-token",
    user: { id: USER, email: "satoru@example.com" },
    ...overrides,
  };
}

describe("storeGmailTokenFromSession", () => {
  it("encrypts and saves the provider refresh token", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null });

    await expect(storeGmailTokenFromSession(mock.client, session(), KEY)).resolves.toBe("stored");

    const [[row]] = argsOf(mock.queries[0], "upsert") as [[Record<string, string>]];
    expect(row.user_id).toBe(USER);
    expect(row.email).toBe("satoru@example.com");
    expect(row.scope).toBe(GOOGLE_GRANTED_SCOPES);
    expect(decrypt(row.refresh_token_encrypted!, KEY, USER)).toBe("1//0test-refresh-token");
  });

  it("does nothing when Google sent no refresh token", async () => {
    for (const token of [undefined, null, ""]) {
      const mock = createSupabaseMock();
      const result = await storeGmailTokenFromSession(
        mock.client,
        session({ provider_refresh_token: token }),
        KEY,
      );
      expect(result).toBe("missing");
      expect(mock.queries).toHaveLength(0);
    }
  });

  it("requires the account email", async () => {
    const mock = createSupabaseMock();
    await expect(
      storeGmailTokenFromSession(mock.client, session({ user: { id: USER } }), KEY),
    ).rejects.toThrow(/no email address/);
    expect(mock.queries).toHaveLength(0);
  });
});
