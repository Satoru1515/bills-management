import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  signInWithOAuth: vi.fn(),
  origin: "http://localhost:3000" as string | null,
  exchangeCode: vi.fn(),
  storeToken: vi.fn(),
}));

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectError(url);
  }),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers(mocks.origin ? { origin: mocks.origin } : {})),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mocks.user }, error: null })),
      signInWithOAuth: mocks.signInWithOAuth,
    },
  })),
}));

vi.mock("@/lib/auth/callback-deps", () => ({
  authCallbackDeps: vi.fn(() => ({
    exchangeCode: mocks.exchangeCode,
    storeToken: mocks.storeToken,
  })),
}));

import {
  finishNativeGoogleSignInAction,
  signInWithGoogleAction,
  startNativeGoogleSignInAction,
} from "./actions";
import LoginPage from "./page";

function params(values: Record<string, string | string[]> = {}) {
  return { searchParams: Promise.resolve(values) };
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof RedirectError)) throw new Error("expected a redirect");
  return error.url;
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.user = null;
  mocks.origin = "http://localhost:3000";
  mocks.signInWithOAuth.mockResolvedValue({
    data: { url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" },
    error: null,
  });
  mocks.exchangeCode.mockResolvedValue({
    session: { provider_refresh_token: "r", user: { id: "u1", email: "satoru@example.com" } },
    error: null,
  });
  mocks.storeToken.mockResolvedValue("stored");
});

describe("LoginPage", () => {
  it("shows the Google button and keeps the next path", async () => {
    render(await LoginPage(params({ next: "/app/settings" })));
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    const hidden = document.querySelector('input[name="next"]') as HTMLInputElement;
    expect(hidden.value).toBe("/app/settings");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never keeps a next path to another site", async () => {
    render(await LoginPage(params({ next: "https://evil.com" })));
    const hidden = document.querySelector('input[name="next"]') as HTMLInputElement;
    expect(hidden.value).toBe("/app");
  });

  it("shows known errors and ignores unknown ones", async () => {
    render(await LoginPage(params({ error: "access_denied" })));
    expect(screen.getByRole("alert")).toHaveTextContent(/cancelled/);
  });

  it("does not echo unknown error codes", async () => {
    render(await LoginPage(params({ error: "<b>hacked</b>" })));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sends signed-in users on to the app", async () => {
    mocks.user = { id: "u1", email: "satoru@example.com" };
    await expect(redirectOf(LoginPage(params({ next: "/app/x" })))).resolves.toBe("/app/x");
  });

  it("stays on the page with an error even when signed in, to allow a retry", async () => {
    mocks.user = { id: "u1", email: "satoru@example.com" };
    render(await LoginPage(params({ error: "gmail_token_failed" })));
    expect(screen.getByRole("alert")).toHaveTextContent(/Gmail access could not be saved/);
  });
});

describe("signInWithGoogleAction", () => {
  it("starts Google sign-in with the callback on the request origin", async () => {
    await expect(redirectOf(signInWithGoogleAction(form({ next: "/app/x" })))).resolves.toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?x=1",
    );
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        options: expect.objectContaining({
          redirectTo: "http://localhost:3000/auth/callback?next=%2Fapp%2Fx",
        }),
      }),
    );
  });

  it("falls back to NEXT_PUBLIC_APP_URL without an Origin header", async () => {
    mocks.origin = null;
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://bills.example.com");
    await redirectOf(signInWithGoogleAction(form({})));
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          redirectTo: "https://bills.example.com/auth/callback",
        }),
      }),
    );
  });

  it("returns to /login with an error when Supabase refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.signInWithOAuth.mockResolvedValue({
      data: { url: null },
      error: { message: "disabled" },
    });
    await expect(redirectOf(signInWithGoogleAction(form({ next: "/app/x" })))).resolves.toBe(
      "/login?next=%2Fapp%2Fx&error=oauth_failed",
    );
  });
});

describe("startNativeGoogleSignInAction", () => {
  it("returns the consent URL with the app's deep link as the callback", async () => {
    await expect(startNativeGoogleSignInAction()).resolves.toEqual({
      ok: true,
      url: "https://accounts.google.com/o/oauth2/v2/auth?x=1",
    });
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        options: expect.objectContaining({
          redirectTo: "com.satoru1515.bills://auth/callback",
        }),
      }),
    );
  });

  it("returns an error message when Supabase refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: "off" } });
    await expect(startNativeGoogleSignInAction()).resolves.toEqual({
      ok: false,
      error: "Google sign-in could not start. Please try again.",
    });
  });
});

describe("finishNativeGoogleSignInAction", () => {
  it("exchanges the code, stores the Gmail token and returns the next page", async () => {
    await expect(
      finishNativeGoogleSignInAction({ code: "abc", error: null }, "/app/settings"),
    ).resolves.toBe("/app/settings");
    expect(mocks.exchangeCode).toHaveBeenCalledWith("abc");
    expect(mocks.storeToken).toHaveBeenCalledOnce();
  });

  it("returns the login error page when the user cancelled", async () => {
    await expect(
      finishNativeGoogleSignInAction({ code: null, error: "access_denied" }, "/app"),
    ).resolves.toBe("/login?error=access_denied");
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });

  it("returns the login error page when the exchange fails", async () => {
    mocks.exchangeCode.mockResolvedValue({ session: null, error: { message: "bad verifier" } });
    await expect(finishNativeGoogleSignInAction({ code: "abc" }, "/app/settings")).resolves.toBe(
      "/login?next=%2Fapp%2Fsettings&error=exchange_failed",
    );
  });

  it("accepts only short strings from the browser", async () => {
    const values: unknown[] = [42, { a: 1 }, "", "x".repeat(2049), null, undefined];
    for (const code of values) {
      await expect(finishNativeGoogleSignInAction({ code }, 7)).resolves.toBe(
        "/login?error=missing_code",
      );
    }
    await expect(
      finishNativeGoogleSignInAction(null as unknown as { code: unknown }, "//evil.com"),
    ).resolves.toBe("/login?error=missing_code");
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });
});
