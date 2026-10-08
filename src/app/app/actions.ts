"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LOGIN_PATH } from "@/lib/auth/redirect";
import { DASHBOARD_PATH } from "@/lib/dashboard/url";
import {
  changeCategory,
  changeIgnored,
  type EditDeps,
  type EditResult,
} from "@/lib/dashboard/edit";
import { setIgnored, updateCategory } from "@/lib/repo/transactions";
import { createClient } from "@/lib/supabase/server";

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(LOGIN_PATH);
}

/** The edits run with the user's own client, so RLS applies as well. */
async function editDeps(): Promise<EditDeps> {
  const supabase = await createClient();
  return {
    async getUserId() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
    updateCategory: (userId, id, category) => updateCategory(supabase, userId, id, category),
    setIgnored: (userId, id, ignored) => setIgnored(supabase, userId, id, ignored),
    log: (message) => console.error(message),
  };
}

/** Inline category edit from the transactions table. */
export async function updateCategoryAction(id: string, category: string): Promise<EditResult> {
  const result = await changeCategory(await editDeps(), id, category);
  if (result.ok) revalidatePath(DASHBOARD_PATH);
  return result;
}

/** Ignore / Restore from the transactions table. */
export async function setIgnoredAction(id: string, ignored: boolean): Promise<EditResult> {
  const result = await changeIgnored(await editDeps(), id, ignored);
  if (result.ok) revalidatePath(DASHBOARD_PATH);
  return result;
}
