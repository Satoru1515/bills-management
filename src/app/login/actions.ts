"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInWithGoogle } from "@/lib/auth/google";
import { callbackUrl, loginUrl, safeNextPath } from "@/lib/auth/redirect";
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

/** The origin the browser used, so the callback returns to the same host. */
async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const origin = headerList.get("origin");
  if (origin && /^https?:\/\//.test(origin)) return origin;
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
}
