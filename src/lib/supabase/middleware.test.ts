// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type CookieAdapter = {
  getAll: () => { name: string; value: string }[];
  setAll: (
    cookies: { name: string; value: string; options: object }[],
    headers?: Record<string, string>,
  ) => void;
};

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  // Cookies the fake client writes during getUser(), like a session refresh.
  refreshed: [] as { name: string; value: string; options: object }[],
  adapter: null as CookieAdapter | null,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: { cookies: CookieAdapter }) => {
    state.adapter = options.cookies;
    return {
      auth: {
        getUser: vi.fn(async () => {
          if (state.refreshed.length > 0) {
            options.cookies.setAll(state.refreshed, { "Cache-Control": "private, no-store" });
          }
          return { data: { user: state.user }, error: null };
        }),
      },
    };
  }),
}));

import { updateSession } from "./middleware";

function request(path: string, cookie?: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  state.user = null;
  state.refreshed = [];
  state.adapter = null;
});

describe("updateSession", () => {
  it("sends signed-out visitors of /app to /login with the page to return to", async () => {
    const response = await updateSession(request("/app/settings?month=2026-09"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fapp%2Fsettings%3Fmonth%3D2026-09",
    );
  });

  it("redirects /app itself without a next parameter", async () => {
    const response = await updateSession(request("/app"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("lets signed-in users through", async () => {
    state.user = { id: "u1" };
    const response = await updateSession(request("/app"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("leaves public pages open to signed-out visitors", async () => {
    for (const path of ["/", "/login", "/auth/callback?code=abc"]) {
      const response = await updateSession(request(path));
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("reads the request cookies", async () => {
    await updateSession(request("/login", "sb-abc-auth-token=session; other=1"));
    expect(state.adapter?.getAll()).toEqual([
      { name: "sb-abc-auth-token", value: "session" },
      { name: "other", value: "1" },
    ]);
  });

  it("writes refreshed session cookies and no-cache headers to the response", async () => {
    state.user = { id: "u1" };
    state.refreshed = [{ name: "sb-abc-auth-token", value: "new", options: { path: "/" } }];
    const response = await updateSession(request("/app", "sb-abc-auth-token=old"));
    expect(response.cookies.get("sb-abc-auth-token")?.value).toBe("new");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps cookie changes on the redirect to /login", async () => {
    state.refreshed = [{ name: "sb-abc-auth-token", value: "", options: { maxAge: 0 } }];
    const response = await updateSession(request("/app", "sb-abc-auth-token=expired"));
    expect(response.status).toBe(307);
    const cleared = response.cookies.get("sb-abc-auth-token");
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge).toBe(0);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
