import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";
import { argsOf, createSupabaseMock, methodsOf } from "@/test/supabase-mock";
import { getRefreshToken, saveGmailConnection } from "./gmail-connections";
import { RepoError } from "./transactions";

// Test-only key; never a real secret.
const KEY = Buffer.alloc(32, 3);
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const TOKEN = "1//0test-refresh-token";

const INPUT = {
  userId: USER,
  email: " satoru@example.com ",
  refreshToken: TOKEN,
  scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
};

describe("saveGmailConnection", () => {
  it("upserts the row with the token encrypted for the user", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null });

    await saveGmailConnection(mock.client, INPUT, KEY);

    expect(mock.queries).toHaveLength(1);
    expect(mock.queries[0]!.table).toBe("gmail_connections");
    expect(methodsOf(mock.queries[0])).toEqual(["upsert"]);
    const [[row, options]] = argsOf(mock.queries[0], "upsert") as [
      [Record<string, unknown>, unknown],
    ];
    expect(options).toEqual({ onConflict: "user_id" });
    expect(Object.keys(row).sort()).toEqual(
      ["email", "refresh_token_encrypted", "scope", "user_id"].sort(),
    );
    expect(row.user_id).toBe(USER);
    expect(row.email).toBe("satoru@example.com");
    expect(row.scope).toBe(INPUT.scope);

    const encrypted = row.refresh_token_encrypted as string;
    expect(encrypted).not.toContain(TOKEN);
    expect(decrypt(encrypted, KEY, USER)).toBe(TOKEN);
    expect(() => decrypt(encrypted, KEY, OTHER_USER)).toThrow();
  });

  it("validates the input before calling the database", async () => {
    const mock = createSupabaseMock();
    await expect(saveGmailConnection(mock.client, { ...INPUT, userId: "" }, KEY)).rejects.toThrow(
      /missing user id/,
    );
    await expect(saveGmailConnection(mock.client, { ...INPUT, email: "  " }, KEY)).rejects.toThrow(
      /missing Gmail address/,
    );
    await expect(
      saveGmailConnection(mock.client, { ...INPUT, refreshToken: "" }, KEY),
    ).rejects.toThrow(/missing refresh token/);
    expect(mock.queries).toHaveLength(0);
  });

  it("wraps database errors in RepoError", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "violates foreign key", code: "23503" } });
    const error = await saveGmailConnection(mock.client, INPUT, KEY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RepoError);
    expect((error as RepoError).code).toBe("23503");
    expect((error as RepoError).message).toBe("saveGmailConnection: violates foreign key");
  });
});

describe("getRefreshToken", () => {
  it("returns the decrypted token of the user", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: { refresh_token_encrypted: encrypt(TOKEN, KEY, USER) } });

    await expect(getRefreshToken(mock.client, USER, KEY)).resolves.toBe(TOKEN);
    expect(methodsOf(mock.queries[0])).toEqual(["select", "eq", "maybeSingle"]);
    expect(argsOf(mock.queries[0], "select")).toEqual([["refresh_token_encrypted"]]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([["user_id", USER]]);
  });

  it("returns null when Gmail is not connected", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null });
    await expect(getRefreshToken(mock.client, USER, KEY)).resolves.toBeNull();
  });

  it("refuses a token encrypted for another user", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: { refresh_token_encrypted: encrypt(TOKEN, KEY, OTHER_USER) } });
    await expect(getRefreshToken(mock.client, USER, KEY)).rejects.toThrow(/Decryption failed/);
  });

  it("wraps database errors in RepoError", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "boom" } });
    await expect(getRefreshToken(mock.client, USER, KEY)).rejects.toThrow("getRefreshToken: boom");
  });
});
