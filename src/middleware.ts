import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Every path except Next.js internals and static files (the PWA files included).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|offline.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
