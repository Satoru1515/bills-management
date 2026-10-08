"use client";

import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { useEffect } from "react";
import { finishNativeGoogleSignInAction } from "@/app/login/actions";
import { createDeepLinkHandler } from "@/lib/auth/native";

/**
 * In the Android app, finishes Google sign-in when the system browser comes
 * back through the deep link (src/lib/auth/native.ts). Does nothing on the
 * web. Renders nothing. `navigate` is replaceable for tests.
 */
export function NativeAuthListener({
  navigate = replaceLocation,
}: {
  navigate?: (path: string) => void;
}) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleDeepLink = createDeepLinkHandler({
      finish: (params, next) => finishNativeGoogleSignInAction(params, next),
      navigate,
      closeBrowser: () => Browser.close(),
      storage: sessionStorageOrNull(),
      log: (message) => console.error(message),
    });

    let cancelled = false;
    let listener: PluginListenerHandle | undefined;
    void App.addListener("appUrlOpen", ({ url }) => void handleDeepLink(url)).then((handle) => {
      if (cancelled) void handle.remove();
      else listener = handle;
    });
    // The link that launched the app, when Android had closed it while the browser was open.
    void App.getLaunchUrl()
      .then((launch) => (launch?.url ? handleDeepLink(launch.url) : false))
      .catch(() => false);

    return () => {
      cancelled = true;
      void listener?.remove();
    };
  }, [navigate]);

  return null;
}

function replaceLocation(path: string) {
  window.location.replace(path);
}

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
