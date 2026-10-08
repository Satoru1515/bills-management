import { redirect } from "next/navigation";
import { APP_HOME } from "@/lib/auth/redirect";

/** The app lives under /app; the middleware sends signed-out visitors to /login. */
export default function Home() {
  redirect(APP_HOME);
}
