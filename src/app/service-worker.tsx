"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/pwa/register";

/** Registers public/sw.js once the page has loaded. Renders nothing. */
export function ServiceWorker() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return null;
}
