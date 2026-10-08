import { redirect } from "next/navigation";
import { loginErrorMessage, safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { signInWithGoogleAction } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata = { title: "Sign in · Bills Management" };

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const error = loginErrorMessage(first(params.error));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // With an error, stay here even if signed in, so the user can retry.
  if (user && !error) redirect(next);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Bills Management</h1>
        <p className="text-sm opacity-80">
          Sign in with Google to turn your bank&apos;s card alerts in Gmail into a monthly spending
          dashboard.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
          {error}
        </p>
      )}

      <form action={signInWithGoogleAction}>
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="w-full rounded-md bg-foreground px-4 py-2 font-medium text-background"
        >
          Continue with Google
        </button>
      </form>

      <p className="text-xs opacity-70">
        The app asks for read-only access to Gmail and only reads alerts from Scotiabank, APAP,
        Banco Santa Cruz and PayPal receipts. It never sends, changes or deletes email.
      </p>
    </main>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
