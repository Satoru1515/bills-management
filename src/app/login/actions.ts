"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { handleAuthCallback } from "@/lib/auth/callback";
import { authCallbackDeps } from "@/lib/auth/callback-deps";
import { signInWithGoogle } from "@/lib/auth/google";
import { NATIVE_CALLBACK_URL, callbackSearchParams } from "@/lib/auth/native";
import {
  CALLBACK_PATH,
  LOGIN_ERRORS,
  callbackUrl,
  loginUrl,
  safeNextPath,
} from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

/** Starts Google sign-in and sends the browser to Google's consent screen. */
export async function signInWithGoogleAction(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next")?.toString());
  const origin = await requestOrigin();

  let consentUrl: string;
  try {
    const supabase = await createClient();
    consentUrl = await signInWithGoogle(supabase, callbackUrl(origin, next));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    const url = loginUrl(origin, next, "oauth_failed");
    redirect(`${url.pathname}${url.search}`);
  }
  redirect(consentUrl);
}

export type NativeSignInStart = { ok: true; url: string } | { ok: false; error: string };

/**
 * Starts Google sign-in in the Android app. Returns the consent URL for the
 * app to open in the system browser (Google refuses WebViews); Supabase comes
 * back to the app's deep link. The PKCE verifier cookie is set here, in the
 * app's WebView. See src/lib/auth/native.ts.
 */
export async function startNativeGoogleSignInAction(): Promise<NativeSignInStart> {
  try {
    const supabase = await createClient();
    return { ok: true, url: await signInWithGoogle(supabase, NATIVE_CALLBACK_URL) };
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return { ok: false, error: LOGIN_ERRORS.oauth_failed };
  }
}

/**
 * Finishes Google sign-in in the Android app with the `code` (or `error`) from
 * the deep link, exactly as /auth/callback does on the web: exchanges the code
 * (sets the session cookies) and stores the Gmail token. Returns the path to
 * open next: `next` on success, /login with an error otherwise.
 */
export async function finishNativeGoogleSignInAction(
  params: { code?: unknown; error?: unknown },
  next: unknown,
): Promise<string> {
  // The arguments come from the browser: only short strings get through.
  const url = new URL(CALLBACK_PATH, await requestOrigin());
  url.search = callbackSearchParams(
    { code: shortString(params?.code), error: shortString(params?.error) },
    shortString(next),
  ).toString();

  const supabase = await createClient();
  const target = await handleAuthCallback(url, authCallbackDeps(supabase));
  return `${target.pathname}${target.search}`;
}

function shortString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 ? value : null;
}

/** The origin the browser used, so the callback returns to the same host. */
async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const origin = headerList.get("origin");
  if (origin && /^https?:\/\//.test(origin)) return origin;
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
}
