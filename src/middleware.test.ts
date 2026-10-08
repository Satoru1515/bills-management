import { describe, expect, it } from "vitest";
import { config } from "./middleware";

// The matcher is a path-to-regexp pattern; this one is also a plain regular expression.
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe("middleware matcher", () => {
  it.each(["/", "/app", "/app/settings", "/login", "/auth/callback", "/api/sync"])(
    "runs on %s",
    (path) => {
      expect(matcher.test(path)).toBe(true);
    },
  );

  it.each([
    "/_next/static/chunks/main.js",
    "/favicon.ico",
    "/sw.js",
    "/manifest.webmanifest",
    "/offline.html",
    "/icons/icon-192.png",
    "/apple-icon.png",
  ])("skips %s", (path) => {
    expect(matcher.test(path)).toBe(false);
  });
});
