import type { MetadataRoute } from "next";
import { webAppManifest } from "@/lib/pwa/manifest";

/** Served as /manifest.webmanifest; Next.js adds the <link rel="manifest">. */
export default function manifest(): MetadataRoute.Manifest {
  return webAppManifest();
}
