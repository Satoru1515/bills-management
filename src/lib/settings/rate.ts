/**
 * The USD → DOP rate form on the settings page: what it accepts and how it is saved.
 * The server action in src/app/app/settings/actions.ts only wires this to Supabase.
 */

import { DEFAULT_USD_TO_DOP_RATE, formatRate } from "@/lib/domain/money";

/** Bounds that catch typos (a missing or extra digit) without limiting real rates. */
export const MIN_RATE = 1;
export const MAX_RATE = 1000;

export type ParsedRate = { ok: true; rate: number | null } | { ok: false; message: string };

const RATE_RE = /^\d{1,4}(?:[.,]\d{1,4})?$/;

/**
 * Reads the rate typed by the user: `63`, `62.85` or `62,85`, up to 4 decimals. Empty means
 * "use the app default" (null).
 */
export function parseRate(value: unknown): ParsedRate {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return { ok: true, rate: null };
  if (!RATE_RE.test(text)) {
    return { ok: false, message: "Enter the rate as a number, for example 62.85." };
  }
  const rate = Number(text.replace(",", "."));
  if (rate < MIN_RATE || rate > MAX_RATE) {
    return {
      ok: false,
      message: `Enter a rate between ${MIN_RATE} and ${MAX_RATE} pesos per dollar.`,
    };
  }
  return { ok: true, rate };
}

export interface RateFormState {
  status: "idle" | "saved" | "error";
  message: string;
}

export const INITIAL_RATE_FORM_STATE: RateFormState = { status: "idle", message: "" };

export interface SaveRateDeps {
  getUserId(): Promise<string | null>;
  /** False when the user has no profile row. */
  setRate(userId: string, rate: number | null): Promise<boolean>;
  log(message: string): void;
}

/** Validates and saves the rate from the form; the result is shown under it. */
export async function saveRate(deps: SaveRateDeps, value: unknown): Promise<RateFormState> {
  const parsed = parseRate(value);
  if (!parsed.ok) return { status: "error", message: parsed.message };

  const userId = await deps.getUserId();
  if (!userId) {
    return { status: "error", message: "Your session expired. Sign in again to save changes." };
  }

  try {
    if (!(await deps.setRate(userId, parsed.rate))) {
      return { status: "error", message: "Your profile was not found. Sign out and in again." };
    }
  } catch (error) {
    deps.log(`saveRate failed: ${error instanceof Error ? error.message : String(error)}`);
    return { status: "error", message: "Could not save the rate. Please try again." };
  }

  return {
    status: "saved",
    message:
      parsed.rate === null
        ? `Saved. Using the default rate of ${formatRate(DEFAULT_USD_TO_DOP_RATE)}.`
        : `Saved. Dollar purchases now count at ${formatRate(parsed.rate)} pesos.`,
  };
}
