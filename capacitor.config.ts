import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps the deployed web app: the Android WebView loads the URL in
 * CAP_SERVER_URL (or NEXT_PUBLIC_APP_URL) instead of bundled files, so the
 * app always runs the same code as the website. The URL is read when running
 * `npx cap sync android` and written to android/app/src/main/assets/
 * capacitor.config.json (git-ignored). See docs/android.md.
 *
 * This file is loaded by the Capacitor CLI on its own, so it imports nothing
 * from src/.
 */

/** Hosts that may use plain http while developing (10.0.2.2 is the host machine seen from the Android emulator). */
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "10.0.2.2"]);

/**
 * The URL the app opens, from the environment. Undefined when none is set
 * (the app then shows mobile/www/index.html, which explains how to set it).
 * Throws on a malformed URL, or on plain http outside the development hosts.
 */
export function resolveServerUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env.CAP_SERVER_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim() || "";
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`CAP_SERVER_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && DEV_HOSTS.has(url.hostname))) {
    throw new Error(
      `CAP_SERVER_URL must use https (plain http only for localhost, 127.0.0.1 or 10.0.2.2): ${raw}`,
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      `CAP_SERVER_URL must be a plain origin or path, without credentials, query or hash: ${raw}`,
    );
  }
  // Capacitor wants no trailing slash on the base URL.
  return url.href.replace(/\/$/, "");
}

export function capacitorConfig(serverUrl: string | undefined): CapacitorConfig {
  return {
    appId: "com.satoru1515.bills",
    appName: "Bills",
    // Only used when no server URL is set: a page explaining how to set it.
    webDir: "mobile/www",
    ...(serverUrl && {
      server: {
        url: serverUrl,
        // Plain http is only allowed for the development hosts above.
        cleartext: serverUrl.startsWith("http:"),
      },
    }),
    android: {
      // Never let mixed (http) content load inside the https app.
      allowMixedContent: false,
    },
  };
}

const config: CapacitorConfig = capacitorConfig(resolveServerUrl());

export default config;
