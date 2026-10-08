/**
 * Data access for `public.category_rules`: the user's own keyword → category rules, applied
 * before the defaults (see `withUserRules` in src/lib/domain/categorize.ts).
 */

import type { StoredCategoryRule } from "@/lib/domain/categorize";
import { RepoError, type DbClient } from "./transactions";

/** The user's rules, oldest first. Categories are unchecked text; `withUserRules` validates them. */
export async function listCategoryRules(
  client: DbClient,
  userId: string,
): Promise<StoredCategoryRule[]> {
  const { data, error } = await client
    .from("category_rules")
    .select("keyword, category")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new RepoError("listCategoryRules", error.message, error.code);
  return (data ?? []).map(({ keyword, category }) => ({ keyword, category }));
}
