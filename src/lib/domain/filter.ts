/**
 * Search and filters for the transactions table. Pure: works on the month's
 * transactions already loaded, ignored ones included.
 */

import { normalizeForMatch } from "./categorize";
import { fromCents, toCents, toDop } from "./money";
import { BANKS, type Bank, type Category, type Transaction } from "./types";

export interface TransactionFilter {
  /** Free text; every word must appear in the merchant, category, bank, card or amount. */
  search?: string;
  bank?: Bank | null;
  category?: Category | null;
}

/** Normalized search words: `  café  bravo ` → `["CAFE", "BRAVO"]`. */
export function searchTerms(search: string): string[] {
  const normalized = normalizeForMatch(search);
  return normalized === "" ? [] : normalized.split(" ");
}

function haystack(transaction: Transaction): string {
  return normalizeForMatch(
    [
      transaction.merchant,
      transaction.category,
      transaction.bank,
      transaction.cardLast4,
      transaction.amount.toFixed(2),
    ].join(" "),
  );
}

/** The transactions that pass every filter given, in their original order. */
export function filterTransactions(
  transactions: readonly Transaction[],
  filter: TransactionFilter,
): Transaction[] {
  const terms = searchTerms(filter.search ?? "");
  return transactions.filter((transaction) => {
    if (filter.bank && transaction.bank !== filter.bank) return false;
    if (filter.category && transaction.category !== filter.category) return false;
    if (terms.length === 0) return true;
    const text = haystack(transaction);
    return terms.every((term) => text.includes(term));
  });
}

/** Banks that appear in `transactions`, in the order of {@link BANKS}. */
export function banksIn(transactions: readonly Transaction[]): Bank[] {
  const present = new Set(transactions.map((transaction) => transaction.bank));
  return BANKS.filter((bank) => present.has(bank));
}

/** Total in pesos of the transactions not ignored, dollars converted at `usdToDopRate`. */
export function totalDop(transactions: readonly Transaction[], usdToDopRate: number): number {
  let cents = 0;
  for (const transaction of transactions) {
    if (transaction.ignored) continue;
    cents += toCents(toDop(transaction.amount, transaction.currency, usdToDopRate));
  }
  return fromCents(cents);
}
