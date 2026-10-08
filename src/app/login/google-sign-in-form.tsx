"use client";

import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { rememberNext } from "@/lib/auth/native";
import { LOGIN_ERRORS } from "@/lib/auth/redirect";
import { signInWithGoogleAction, startNativeGoogleSignInAction } from "./actions";

/**
 * A form that starts Google sign-in. On the web it posts to
 * `signInWithGoogleAction`, which redirects to Google. In the Android app it
 * opens Google's consent screen in the system browser instead, because Google
 * refuses sign-in inside WebViews; the app comes back through a deep link
 * (see NativeAuthListener). The children hold the `next` hidden input and the
 * submit button.
 */
export function GoogleSignInForm({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (!Capacitor.isNativePlatform()) return;
    // Cancels the server action; React skips a form action whose submit was prevented.
    event.preventDefault();
    const next = new FormData(event.currentTarget).get("next")?.toString();
    setError(null);
    startTransition(async () => {
      const result = await startNativeGoogleSignInAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      rememberNext(sessionStorageOrNull(), next);
      try {
        await Browser.open({ url: result.url });
      } catch {
        setError(LOGIN_ERRORS.oauth_failed);
      }
    });
  }

  return (
    <form
      action={signInWithGoogleAction}
      onSubmit={onSubmit}
      className={className}
      aria-busy={pending || undefined}
    >
      {children}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
