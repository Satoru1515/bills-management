import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";
import { argsOf, createSupabaseMock, methodsOf } from "@/test/supabase-mock";
import {
  getGmailConnectionStatus,
  getLastSyncAt,
  getRefreshToken,
  listConnectedUserIds,
  saveGmailConnection,
  setLastSyncAt,
} from "./gmail-connections";
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

describe("getLastSyncAt / setLastSyncAt", () => {
  it("reads last_sync_at, null if never synced, undefined if not connected", async () => {
    const mock = createSupabaseMock();
    mock.respond(
      { data: { last_sync_at: "2026-10-07T16:00:00+00:00" } },
      { data: { last_sync_at: null } },
      { data: null },
    );
    await expect(getLastSyncAt(mock.client, USER)).resolves.toBe("2026-10-07T16:00:00+00:00");
    await expect(getLastSyncAt(mock.client, USER)).resolves.toBeNull();
    await expect(getLastSyncAt(mock.client, USER)).resolves.toBeUndefined();
    expect(methodsOf(mock.queries[0])).toEqual(["select", "eq", "maybeSingle"]);
    expect(argsOf(mock.queries[0], "select")).toEqual([["last_sync_at"]]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([["user_id", USER]]);
  });

  it("updates only last_sync_at of the user's row", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null });
    await setLastSyncAt(mock.client, USER, "2026-10-07T16:00:00.000Z");
    expect(mock.queries[0]!.table).toBe("gmail_connections");
    expect(methodsOf(mock.queries[0])).toEqual(["update", "eq"]);
    expect(argsOf(mock.queries[0], "update")).toEqual([
      [{ last_sync_at: "2026-10-07T16:00:00.000Z" }],
    ]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([["user_id", USER]]);
  });

  it("wraps database errors in RepoError", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "boom", code: "XX000" } }, { error: { message: "nope" } });
    await expect(getLastSyncAt(mock.client, USER)).rejects.toMatchObject({
      name: "RepoError",
      message: "getLastSyncAt: boom",
      code: "XX000",
    });
    await expect(setLastSyncAt(mock.client, USER, "x")).rejects.toThrow("setLastSyncAt: nope");
  });
});

describe("listConnectedUserIds", () => {
  it("returns every connected user id, in a stable order", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: [{ user_id: USER }, { user_id: OTHER_USER }] }, { data: null });
    await expect(listConnectedUserIds(mock.client)).resolves.toEqual([USER, OTHER_USER]);
    await expect(listConnectedUserIds(mock.client)).resolves.toEqual([]);
    expect(mock.queries[0]!.table).toBe("gmail_connections");
    expect(methodsOf(mock.queries[0])).toEqual(["select", "order"]);
    expect(argsOf(mock.queries[0], "select")).toEqual([["user_id"]]);
  });

  it("wraps database errors in RepoError", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "boom" } });
    await expect(listConnectedUserIds(mock.client)).rejects.toThrow("listConnectedUserIds: boom");
  });
});

describe("getGmailConnectionStatus", () => {
  it("reads only the columns users may see", async () => {
    const mock = createSupabaseMock();
    mock.respond({
      data: {
        email: "satoru@gmail.com",
        scope: "openid email",
        last_sync_at: "2026-10-07T16:00:00+00:00",
        created_at: "2026-10-01T12:00:00+00:00",
      },
    });

    await expect(getGmailConnectionStatus(mock.client, USER)).resolves.toEqual({
      email: "satoru@gmail.com",
      scope: "openid email",
      lastSyncAt: "2026-10-07T16:00:00+00:00",
      connectedAt: "2026-10-01T12:00:00+00:00",
    });
    expect(mock.queries[0]!.table).toBe("gmail_connections");
    expect(argsOf(mock.queries[0], "select")).toEqual([["email, scope, last_sync_at, created_at"]]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([["user_id", USER]]);
    expect(methodsOf(mock.queries[0])).toEqual(["select", "eq", "maybeSingle"]);
  });

  it("is null when Gmail is not connected, and wraps errors", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null }, { error: { message: "boom" } });
    await expect(getGmailConnectionStatus(mock.client, USER)).resolves.toBeNull();
    await expect(getGmailConnectionStatus(mock.client, USER)).rejects.toThrow(RepoError);
  });
});
