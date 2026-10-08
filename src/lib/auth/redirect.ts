/**
 * Paths and redirect targets of the sign-in flow. Pure functions.
 */

/** Where signed-in users land by default. */
export const APP_HOME = "/app";
export const LOGIN_PATH = "/login";
export const CALLBACK_PATH = "/auth/callback";

/** `/app` and everything under it requires a signed-in user. */
export function isProtectedPath(pathname: string): boolean {
  return pathname === APP_HOME || pathname.startsWith(`${APP_HOME}/`);
}

/**
 * Returns `next` only if it is a path on this site (so the sign-in flow can
 * never redirect to another domain), otherwise `fallback`.
 */
export function safeNextPath(next: string | null | undefined, fallback = APP_HOME): string {
  if (!next || !next.startsWith("/")) return fallback;
  // "//evil.com" and "/\evil.com" are protocol-relative URLs in browsers.
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // Control characters (tabs and newlines are stripped by URL parsers).
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = "http://localhost";
    const url = new URL(next, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** The OAuth `redirectTo`: the auth callback, carrying where to go afterwards. */
export function callbackUrl(origin: string, next: string | null | undefined): string {
  const url = new URL(CALLBACK_PATH, origin);
  const path = safeNextPath(next);
  if (path !== APP_HOME) url.searchParams.set("next", path);
  return url.toString();
}

/** `/login`, remembering the page the user asked for, and an optional error code. */
export function loginUrl(origin: string, next?: string | null, error?: LoginErrorCode): URL {
  const url = new URL(LOGIN_PATH, origin);
  const path = safeNextPath(next);
  if (path !== APP_HOME) url.searchParams.set("next", path);
  if (error) url.searchParams.set("error", error);
  return url;
}

export const LOGIN_ERRORS = {
  access_denied: "Google sign-in was cancelled. Gmail access is needed to read your card alerts.",
  missing_code: "The sign-in link is incomplete. Please try again.",
  exchange_failed: "The sign-in could not be completed. Please try again.",
  gmail_token_failed:
    "You are signed in, but Gmail access could not be saved. Sign in again to retry.",
  oauth_failed: "Google sign-in could not start. Please try again.",
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERRORS;

/** The message for an `?error=` code, or null if the code is unknown or absent. */
export function loginErrorMessage(code: string | null | undefined): string | null {
  if (!code || !Object.hasOwn(LOGIN_ERRORS, code)) return null;
  return LOGIN_ERRORS[code as LoginErrorCode];
}
