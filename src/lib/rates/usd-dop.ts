/**
 * The USD → DOP exchange rate of a given day, from the free currency API by Fawaz Ahmed
 * (https://github.com/fawazahmed0/exchange-api): daily rates since March 2024, no key needed.
 * It is served from jsDelivr with a Cloudflare Pages mirror as fallback.
 *
 * `fetch` is injectable so tests never touch the network.
 */

import { currentDay, formatDay, isDay } from "@/lib/domain/day";
import { MAX_RATE, MIN_RATE } from "@/lib/settings/rate";

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Where the rates of `day` (`YYYY-MM-DD`, or `latest`) are published, in order of preference. */
export function rateUrls(day: string): string[] {
  return [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/usd.json`,
    `https://${day}.currency-api.pages.dev/v1/currencies/usd.json`,
  ];
}

/** The first day the API has rates for. */
export const FIRST_RATE_DAY = "2024-03-02";

export interface DayRate {
  /** The day the rate is for, as the API reports it. */
  date: string;
  /** Pesos per dollar, rounded to 4 decimals. */
  rate: number;
}

export type RateLookup =
  { ok: true; date: string; rate: number; message: string } | { ok: false; message: string };

/** Reads `{ date, usd: { dop } }`; null if the body has no usable rate. */
export function parseRateBody(body: unknown): DayRate | null {
  if (typeof body !== "object" || body === null) return null;
  const { date, usd } = body as { date?: unknown; usd?: unknown };
  if (typeof date !== "string" || typeof usd !== "object" || usd === null) return null;
  const dop = (usd as { dop?: unknown }).dop;
  if (typeof dop !== "number" || !Number.isFinite(dop) || dop < MIN_RATE || dop > MAX_RATE) {
    return null;
  }
  return { date, rate: Math.round(dop * 10_000) / 10_000 };
}

/**
 * The USD → DOP rate of `day`, trying each mirror in turn. Null when no mirror has it
 * (not published, network down or unexpected answer).
 */
export async function fetchUsdToDopRate(
  day: string,
  doFetch: HttpFetch = (url, init) => fetch(url, init),
): Promise<DayRate | null> {
  for (const url of rateUrls(day)) {
    try {
      const response = await doFetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const parsed = parseRateBody(await response.json());
      if (parsed) return parsed;
    } catch {
      // Try the next mirror.
    }
  }
  return null;
}

/** Validates the day, fetches its rate and says what happened, for the settings form. */
export async function lookupRate(
  value: unknown,
  now: Date,
  doFetch?: HttpFetch,
): Promise<RateLookup> {
  const day = typeof value === "string" ? value.trim() : "";
  if (!isDay(day)) return { ok: false, message: "Pick a day to look up." };
  const today = currentDay(now);
  if (day > today) return { ok: false, message: "Pick today or a day in the past." };
  if (day < FIRST_RATE_DAY) {
    return { ok: false, message: `Rates are available from ${formatDay(FIRST_RATE_DAY)} on.` };
  }

  // Today's file is published during the day; until then the latest one is yesterday's.
  const found =
    (await fetchUsdToDopRate(day, doFetch)) ??
    (day === today ? await fetchUsdToDopRate("latest", doFetch) : null);
  if (!found) {
    return {
      ok: false,
      message: "Could not get the rate for that day. Try again later or type it in.",
    };
  }
  const date = isDay(found.date) ? found.date : day;
  return {
    ok: true,
    date,
    rate: found.rate,
    message: `Rate on ${formatDay(date)}: ${found.rate}. Press Save to use it.`,
  };
}
