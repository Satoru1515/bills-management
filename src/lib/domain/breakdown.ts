/**
 * Spending of one month split by category and by bank and card, in pesos (dollars
 * converted at the user's rate). Ignored transactions are left out.
 */

import { fromCents, toCents, toDop } from "./money";
import { BANKS, CATEGORIES, type Bank, type Category, type Transaction } from "./types";

export interface CategoryTotal {
  category: Category;
  totalDop: number;
  count: number;
  /** Fraction of the month's total (0 to 1). */
  share: number;
}

export interface CardTotal {
  cardLast4: string;
  totalDop: number;
  count: number;
}

export interface BankTotal {
  bank: Bank;
  totalDop: number;
  count: number;
  /** Largest first. */
  cards: CardTotal[];
}

interface Bucket {
  cents: number;
  count: number;
}

function add(map: Map<string, Bucket>, key: string, cents: number): void {
  const bucket = map.get(key) ?? { cents: 0, count: 0 };
  bucket.cents += cents;
  bucket.count += 1;
  map.set(key, bucket);
}

function centsOf(transaction: Transaction, usdToDopRate: number): number {
  return toCents(toDop(transaction.amount, transaction.currency, usdToDopRate));
}

/**
 * Categories with at least one purchase, largest first; ties keep the order of
 * {@link CATEGORIES}.
 */
export function totalsByCategory(
  transactions: readonly Transaction[],
  usdToDopRate: number,
): CategoryTotal[] {
  const buckets = new Map<string, Bucket>();
  let totalCents = 0;
  for (const transaction of transactions) {
    if (transaction.ignored) continue;
    const cents = centsOf(transaction, usdToDopRate);
    totalCents += cents;
    add(buckets, transaction.category, cents);
  }

  return CATEGORIES.flatMap((category) => {
    const bucket = buckets.get(category);
    if (!bucket) return [];
    return [
      {
        category,
        totalDop: fromCents(bucket.cents),
        count: bucket.count,
        share: totalCents > 0 ? bucket.cents / totalCents : 0,
      },
    ];
  }).sort((a, b) => b.totalDop - a.totalDop);
}

/**
 * Banks with at least one purchase (only of `category`, when given) and their cards,
 * largest first; banks tie in the order of {@link BANKS}, cards by their digits.
 */
export function totalsByBank(
  transactions: readonly Transaction[],
  usdToDopRate: number,
  category: Category | null = null,
): BankTotal[] {
  const banks = new Map<string, Bucket>();
  const cards = new Map<string, Map<string, Bucket>>();
  for (const transaction of transactions) {
    if (transaction.ignored) continue;
    if (category !== null && transaction.category !== category) continue;
    const cents = centsOf(transaction, usdToDopRate);
    add(banks, transaction.bank, cents);
    const bankCards = cards.get(transaction.bank) ?? new Map<string, Bucket>();
    add(bankCards, transaction.cardLast4, cents);
    cards.set(transaction.bank, bankCards);
  }

  return BANKS.flatMap((bank) => {
    const bucket = banks.get(bank);
    if (!bucket) return [];
    const bankCards = [...(cards.get(bank) ?? new Map<string, Bucket>())]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cardLast4, card]) => ({
        cardLast4,
        totalDop: fromCents(card.cents),
        count: card.count,
      }))
      .sort((a, b) => b.totalDop - a.totalDop);
    return [{ bank, totalDop: fromCents(bucket.cents), count: bucket.count, cards: bankCards }];
  }).sort((a, b) => b.totalDop - a.totalDop);
}
