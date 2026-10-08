import type { MetadataRoute } from "next";
import { APP_HOME } from "@/lib/auth/redirect";

export const APP_NAME = "Bills Management";
export const APP_SHORT_NAME = "Bills";

/** --background of src/app/globals.css, per theme (used for the browser chrome). */
export const THEME_COLORS = { light: "#f7f7f5", dark: "#121212" } as const;

/**
 * Web app manifest: what makes the app installable from the browser. It
 * opens on the dashboard (the middleware sends signed-out users to /login).
 */
export function webAppManifest(): MetadataRoute.Manifest {
  return {
    id: APP_HOME,
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: "Card spending from bank email alerts",
    lang: "en",
    start_url: APP_HOME,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    categories: ["finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
