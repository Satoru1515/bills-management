/**
 * Amounts and currency conversion for totals. Amounts are rounded to cents with
 * integer arithmetic so sums of many purchases do not drift.
 */

import type { Currency } from "./types";

/**
 * USD → DOP rate used when the user has not set one in their profile
 * (`profiles.usd_to_dop_rate`). Approximate market rate; the settings page lets the user
 * replace it.
 */
export const DEFAULT_USD_TO_DOP_RATE = 63;

const SYMBOLS: Record<Currency, string> = { DOP: "RD$", USD: "US$" };

const AMOUNT_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const RATE_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const PERCENT_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** `amount` in pesos: DOP as is, USD multiplied by `usdToDopRate`, rounded to cents. */
export function toDop(amount: number, currency: Currency, usdToDopRate: number): number {
  return currency === "DOP" ? amount : fromCents(Math.round(amount * usdToDopRate * 100));
}

/** `1234.5, "DOP"` → `RD$ 1,234.50`. */
export function formatMoney(amount: number, currency: Currency): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${SYMBOLS[currency]} ${AMOUNT_FORMAT.format(Math.abs(amount))}`;
}

/** A USD → DOP rate for display, e.g. `63.5` → `63.50`, `62.1234` → `62.1234`. */
export function formatRate(rate: number): string {
  return RATE_FORMAT.format(rate);
}

/**
 * Relative change from `previous` to `current` as a fraction (`0.25` = +25 %).
 * Null when there is nothing to compare against (`previous` is 0).
 */
export function relativeChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

/** `0.1234` → `+12.3%`, `-0.05` → `−5.0%`, `0` → `0.0%`. */
export function formatChange(change: number): string {
  const percent = Math.round(change * 1000) / 10;
  if (percent === 0) return "0.0%";
  return `${percent > 0 ? "+" : "−"}${PERCENT_FORMAT.format(Math.abs(percent))}%`;
}
