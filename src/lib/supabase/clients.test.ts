import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "./database.types";

const ssr = vi.hoisted(() => ({
  createBrowserClient: vi.fn<(...args: unknown[]) => object>(() => ({ kind: "browser" })),
  createServerClient: vi.fn<(...args: unknown[]) => object>(() => ({ kind: "server" })),
}));
vi.mock("@supabase/ssr", () => ssr);

const supabaseJs = vi.hoisted(() => ({
  createClient: vi.fn<(...args: unknown[]) => object>(() => ({ kind: "admin" })),
}));
vi.mock("@supabase/supabase-js", () => supabaseJs);

const cookieStore = vi.hoisted(() => ({
  getAll: vi.fn(() => [{ name: "sb-abc-auth-token", value: "session" }]),
  set: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));

import { createAdminClient } from "./admin";
import { createClient as createBrowserSupabase } from "./client";
import { createClient as createServerSupabase } from "./server";

type CookieAdapter = {
  getAll: () => unknown;
  setAll: (cookies: { name: string; value: string; options: object }[]) => void;
};

function serverCookieAdapter(): CookieAdapter {
  const options = ssr.createServerClient.mock.calls[0]?.[2] as { cookies: CookieAdapter };
  return options.cookies;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
});

describe("browser client", () => {
  it("uses the public URL and the anon key", () => {
    expect(createBrowserSupabase()).toEqual({ kind: "browser" });
    expect(ssr.createBrowserClient).toHaveBeenCalledWith("https://abc.supabase.co", "anon-key");
  });

  it("fails clearly without configuration", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(() => createBrowserSupabase()).toThrow("NEXT_PUBLIC_SUPABASE_URL");
    expect(ssr.createBrowserClient).not.toHaveBeenCalled();
  });
});

describe("server client", () => {
  it("uses the anon key, never the service role key", async () => {
    await expect(createServerSupabase()).resolves.toEqual({ kind: "server" });
    const [url, key] = ssr.createServerClient.mock.calls[0];
    expect(url).toBe("https://abc.supabase.co");
    expect(key).toBe("anon-key");
  });

  it("reads the request cookies", async () => {
    await createServerSupabase();
    expect(serverCookieAdapter().getAll()).toEqual([
      { name: "sb-abc-auth-token", value: "session" },
    ]);
  });

  it("writes every refreshed cookie", async () => {
    await createServerSupabase();
    serverCookieAdapter().setAll([
      { name: "a", value: "1", options: { path: "/" } },
      { name: "b", value: "2", options: { httpOnly: true } },
    ]);
    expect(cookieStore.set).toHaveBeenCalledTimes(2);
    expect(cookieStore.set).toHaveBeenNthCalledWith(1, "a", "1", { path: "/" });
    expect(cookieStore.set).toHaveBeenNthCalledWith(2, "b", "2", { httpOnly: true });
  });

  it("ignores the error Server Components raise when setting cookies", async () => {
    cookieStore.set.mockImplementationOnce(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
    });
    await createServerSupabase();
    expect(() =>
      serverCookieAdapter().setAll([{ name: "a", value: "1", options: {} }]),
    ).not.toThrow();
  });
});

describe("admin client", () => {
  it("uses the service role key without persisting a session", () => {
    expect(createAdminClient()).toEqual({ kind: "admin" });
    expect(supabaseJs.createClient).toHaveBeenCalledWith("https://abc.supabase.co", "service-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it("refuses to start without the service role key", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => createAdminClient()).toThrow("SUPABASE_SERVICE_ROLE_KEY");
  });
});

describe("Database types", () => {
  it("type the clients' tables (checked by tsc)", () => {
    expectTypeOf<ReturnType<typeof createBrowserSupabase>>().toEqualTypeOf<
      SupabaseClient<Database, "public">
    >();
    expectTypeOf<Awaited<ReturnType<typeof createServerSupabase>>>().toEqualTypeOf<
      SupabaseClient<Database, "public">
    >();
    expectTypeOf<Tables<"transactions">["amount"]>().toEqualTypeOf<number>();
    expectTypeOf<Tables<"transactions">["gmail_message_id"]>().toEqualTypeOf<string | null>();
    expectTypeOf<TablesInsert<"transactions">["ignored"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Tables<"profiles">["usd_to_dop_rate"]>().toEqualTypeOf<number | null>();
  });
});
