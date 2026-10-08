"use server";

import { revalidatePath } from "next/cache";
import { DASHBOARD_PATH } from "@/lib/dashboard/url";
import { lookupRate, type RateLookup } from "@/lib/rates/usd-dop";
import { setUsdToDopRate } from "@/lib/repo/profiles";
import { saveRate, type RateFormState } from "@/lib/settings/rate";
import { createClient } from "@/lib/supabase/server";

/** The USD → DOP rate form, with the user's own client (RLS applies as well). */
export async function saveRateAction(
  _previous: RateFormState,
  formData: FormData,
): Promise<RateFormState> {
  const supabase = await createClient();
  const state = await saveRate(
    {
      async getUserId() {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        return user?.id ?? null;
      },
      setRate: (userId, rate) => setUsdToDopRate(supabase, userId, rate),
      log: (message) => console.error(message),
    },
    formData.get("rate"),
  );
  // The dashboard and this page both show the rate.
  if (state.status === "saved") revalidatePath(DASHBOARD_PATH, "layout");
  return state;
}

/** Looks up the USD → DOP rate of a day for the signed-in user (nothing is saved). */
export async function lookupRateAction(day: string): Promise<RateLookup> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Your session expired. Sign in again." };
  return lookupRate(day, new Date());
}
