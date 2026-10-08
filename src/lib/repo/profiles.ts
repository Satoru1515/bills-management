/**
 * Data access for `public.profiles`.
 */

import { RepoError, type DbClient } from "./transactions";

/**
 * The user's own USD → DOP rate, or null when they have not set one (or have no profile
 * row yet), so the caller falls back to `DEFAULT_USD_TO_DOP_RATE`.
 */
export async function getUsdToDopRate(client: DbClient, userId: string): Promise<number | null> {
  const { data, error } = await client
    .from("profiles")
    .select("usd_to_dop_rate")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new RepoError("getUsdToDopRate", error.message, error.code);

  const value = data?.usd_to_dop_rate;
  if (value === null || value === undefined) return null;
  // PostgREST may send numeric columns as strings.
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}
