import { describe, expect, it } from "vitest";
import {
  callbackUrl,
  isProtectedPath,
  LOGIN_ERRORS,
  loginErrorMessage,
  loginUrl,
  safeNextPath,
} from "./redirect";

const ORIGIN = "http://localhost:3000";

describe("isProtectedPath", () => {
  it("protects /app and everything below it", () => {
    expect(isProtectedPath("/app")).toBe(true);
    expect(isProtectedPath("/app/")).toBe(true);
    expect(isProtectedPath("/app/settings")).toBe(true);
  });

  it("leaves public paths open", () => {
    for (const path of [
      "/",
      "/login",
      "/auth/callback",
      "/apple",
      "/application",
      "/api/cron/sync",
    ]) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });
});

describe("safeNextPath", () => {
  it("keeps local paths with their query and hash", () => {
    expect(safeNextPath("/app")).toBe("/app");
    expect(safeNextPath("/app/settings?month=2026-09#top")).toBe("/app/settings?month=2026-09#top");
  });

  it("falls back to /app for missing or relative values", () => {
    expect(safeNextPath(null)).toBe("/app");
    expect(safeNextPath(undefined)).toBe("/app");
    expect(safeNextPath("")).toBe("/app");
    expect(safeNextPath("app")).toBe("/app");
    expect(safeNextPath("/login", "/elsewhere")).toBe("/login");
    expect(safeNextPath("nope", "/elsewhere")).toBe("/elsewhere");
  });

  it("never allows another origin", () => {
    for (const evil of [
      "https://evil.com",
      "//evil.com",
      "//evil.com/app",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "javascript:alert(1)",
      "http:/evil.com",
    ]) {
      expect(safeNextPath(evil)).toBe("/app");
    }
  });

  it("normalizes dot segments instead of escaping the site", () => {
    expect(safeNextPath("/app/../../etc")).toBe("/etc");
  });
});

describe("callbackUrl", () => {
  it("points to /auth/callback on the same origin", () => {
    expect(callbackUrl(ORIGIN, null)).toBe("http://localhost:3000/auth/callback");
    expect(callbackUrl(ORIGIN, "/app")).toBe("http://localhost:3000/auth/callback");
  });

  it("carries a safe next path", () => {
    expect(callbackUrl(ORIGIN, "/app/settings?x=1")).toBe(
      "http://localhost:3000/auth/callback?next=%2Fapp%2Fsettings%3Fx%3D1",
    );
    expect(callbackUrl(ORIGIN, "//evil.com")).toBe("http://localhost:3000/auth/callback");
  });
});

describe("loginUrl", () => {
  it("builds /login with next and error", () => {
    expect(loginUrl(ORIGIN).toString()).toBe("http://localhost:3000/login");
    expect(loginUrl(ORIGIN, "/app/settings", "exchange_failed").toString()).toBe(
      "http://localhost:3000/login?next=%2Fapp%2Fsettings&error=exchange_failed",
    );
    expect(loginUrl(ORIGIN, "https://evil.com").toString()).toBe("http://localhost:3000/login");
  });
});

describe("loginErrorMessage", () => {
  it("maps every known code to a message", () => {
    for (const code of Object.keys(LOGIN_ERRORS)) {
      expect(loginErrorMessage(code)).toMatch(/\w/);
    }
  });

  it("ignores unknown codes, so the page never echoes arbitrary text", () => {
    expect(loginErrorMessage(null)).toBeNull();
    expect(loginErrorMessage("<script>")).toBeNull();
    expect(loginErrorMessage("toString")).toBeNull();
  });
});
