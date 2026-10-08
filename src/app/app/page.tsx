import { redirect } from "next/navigation";
import { LOGIN_PATH } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "./actions";
import { SyncButton } from "./sync-button";

export const metadata = { title: "Bills Management" };

/** Signed-in home. The middleware already guards /app; this check is a second line. */
export default async function AppHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(LOGIN_PATH);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Bills Management</h1>
        <form action={signOutAction}>
          <button type="submit" className="text-sm underline underline-offset-4">
            Sign out
          </button>
        </form>
      </header>
      <p className="text-sm opacity-80">
        Signed in as <strong>{user.email}</strong>. The spending dashboard arrives in a later phase.
      </p>
      <SyncButton />
    </main>
  );
}
