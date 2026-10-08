import { afterEach, describe, expect, it, vi } from "vitest";
import { supabasePublicEnv, supabaseServiceRoleKey } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("supabasePublicEnv", () => {
  it("returns the URL and anon key, trimmed", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", " https://abc.supabase.co ");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key\n");
    expect(supabasePublicEnv()).toEqual({ url: "https://abc.supabase.co", anonKey: "anon-key" });
  });

  it("names the missing variable", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(() => supabasePublicEnv()).toThrow("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("treats a blank value as missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "   ");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    expect(() => supabasePublicEnv()).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  });
});

describe("supabaseServiceRoleKey", () => {
  it("returns the key", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    expect(supabaseServiceRoleKey()).toBe("service-key");
  });

  it("throws when it is not set", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => supabaseServiceRoleKey()).toThrow("SUPABASE_SERVICE_ROLE_KEY");
  });
});
