import Link from "next/link";
import { DASHBOARD_PATH } from "@/lib/dashboard/url";
import { signOutAction } from "./actions";

/** Shell of the signed-in pages: app name and sign out above the page content. */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-5 sm:px-6">
      <header className="flex items-center justify-between gap-4 border-b border-current/10 pb-4">
        <h1 className="text-base font-semibold">
          <Link href={DASHBOARD_PATH}>Bills Management</Link>
        </h1>
        <form action={signOutAction}>
          <button type="submit" className="text-sm underline underline-offset-4">
            Sign out
          </button>
        </form>
      </header>
      <main className="flex flex-col gap-6">{children}</main>
    </div>
  );
}
