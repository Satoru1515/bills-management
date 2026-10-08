/**
 * Google sign-in inside the Android app (Capacitor). Pure functions.
 *
 * Google refuses OAuth inside embedded WebViews (`403 disallowed_useragent`),
 * so the app opens the consent screen in the system browser (a Custom Tab)
 * and Supabase sends the browser back to the app through a deep link:
 *
 *   app WebView ── server action: signInWithOAuth (PKCE verifier cookie in the WebView)
 *        │ consent URL
 *        ▼
 *   Custom Tab ── Google consent ── <supabase>/auth/v1/callback
 *        │ com.satoru1515.bills://auth/callback?code=…
 *        ▼
 *   app WebView ── server action: exchange the code (verifier cookie) and store the Gmail token
 *
 * The code alone is useless without the PKCE verifier, which only the app's
 * WebView has, so another app catching the deep link cannot sign in with it.
 * The code is exchanged in a server action (a POST) and not by opening
 * /auth/callback, because Capacitor fetches the app's HTML pages itself and
 * would drop the session cookies set on that page's redirect.
 */

import { LOGIN_PATH, safeNextPath } from "./redirect";

/** The app's URL scheme (its app ID, `custom_url_scheme` in android/app/src/main/res/values/strings.xml). */
export const APP_URL_SCHEME = "com.satoru1515.bills";

/**
 * Where Supabase sends the browser after Google sign-in in the app. Must be in
 * Supabase's Redirect URLs. It carries no query, so it matches that list
 * exactly; the page to open afterwards is kept in the WebView (see
 * `NEXT_STORAGE_KEY`).
 */
export const NATIVE_CALLBACK_URL = `${APP_URL_SCHEME}://auth/callback`;

/** sessionStorage key for the page to open after signing in in the app. */
export const NEXT_STORAGE_KEY = "bills:native-sign-in-next";

/** sessionStorage key for the deep links already handled (each code works once). */
export const HANDLED_STORAGE_KEY = "bills:native-sign-in-handled";

/** What Supabase put on the deep link. */
export interface NativeCallbackParams {
  code: string | null;
  error: string | null;
}

/**
 * Reads the sign-in result from a deep link, or null when the link is not the
 * sign-in callback (another deep link, or not a URL at all).
 */
export function parseNativeCallback(deepLink: string): NativeCallbackParams | null {
  let url: URL;
  try {
    url = new URL(deepLink);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_URL_SCHEME}:`) return null;
  if (url.hostname !== "auth" || url.pathname.replace(/\/$/, "") !== "/callback") return null;

  // Errors usually come in the query; older flows put them in the fragment.
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  return {
    code: url.searchParams.get("code") || null,
    error: url.searchParams.get("error") || hash.get("error") || null,
  };
}

/** The `?code=`/`?error=` query /auth/callback would have received. */
export function callbackSearchParams(
  params: NativeCallbackParams,
  next: string | null | undefined,
): URLSearchParams {
  const search = new URLSearchParams();
  if (params.code) search.set("code", params.code);
  if (params.error) search.set("error", params.error);
  const path = safeNextPath(next);
  search.set("next", path);
  return search;
}

/** The small part of `Storage` the handler needs (sessionStorage in the app). */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface DeepLinkHandlerDeps {
  /** Exchanges the code on the server; returns the path to open (next page or /login?error=). */
  finish: (params: NativeCallbackParams, next: string) => Promise<string>;
  /** Opens a path in the WebView (location.replace in the app). */
  navigate: (path: string) => void;
  /** Closes the Custom Tab if it is still open. */
  closeBrowser: () => Promise<void>;
  storage: KeyValueStorage | null;
  log?: (message: string) => void;
}

/**
 * Builds the function that handles a deep link opened in the app. It returns
 * false for links that are not the sign-in callback, and ignores a link it
 * already handled (Capacitor reports the link that launched the app on every
 * page load, and a code only works once).
 */
export function createDeepLinkHandler(deps: DeepLinkHandlerDeps) {
  const log = deps.log ?? (() => {});

  return async function handleDeepLink(deepLink: string): Promise<boolean> {
    const params = parseNativeCallback(deepLink);
    if (!params) return false;
    if (wasHandled(deps.storage, deepLink)) return false;
    markHandled(deps.storage, deepLink);

    const next = safeNextPath(read(deps.storage, NEXT_STORAGE_KEY));
    remove(deps.storage, NEXT_STORAGE_KEY);

    try {
      await deps.closeBrowser();
    } catch {
      // Already closed (Android closes it when the app comes back to the front).
    }

    let target: string;
    try {
      target = await deps.finish(params, next);
    } catch (error) {
      log(`native sign-in: ${error instanceof Error ? error.message : String(error)}`);
      target = `${LOGIN_PATH}?error=exchange_failed`;
    }
    deps.navigate(target);
    return true;
  };
}

/** Remembers the page to open after signing in (called before opening the browser). */
export function rememberNext(storage: KeyValueStorage | null, next: string | null | undefined) {
  write(storage, NEXT_STORAGE_KEY, safeNextPath(next));
}

// Handled links are kept in a short list; only the last few matter.
const MAX_HANDLED = 5;

function wasHandled(storage: KeyValueStorage | null, deepLink: string): boolean {
  return handledLinks(storage).includes(deepLink);
}

function markHandled(storage: KeyValueStorage | null, deepLink: string) {
  const links = [...handledLinks(storage), deepLink].slice(-MAX_HANDLED);
  write(storage, HANDLED_STORAGE_KEY, JSON.stringify(links));
}

function handledLinks(storage: KeyValueStorage | null): string[] {
  const raw = read(storage, HANDLED_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

// Storage can throw (disabled storage, quota); sign-in still works without it.
function read(storage: KeyValueStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: KeyValueStorage | null, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    // Ignored, see read().
  }
}

function remove(storage: KeyValueStorage | null, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // Ignored, see read().
  }
}
