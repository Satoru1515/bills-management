/**
 * Collapses the repeated Scotiabank alerts for a single purchase (docs/parsing-spec.md §1).
 * Scotiabank sends one email per alert subject ("Uso de tarjeta de crédito",
 * "Autorización fuera del país", "Autorización sin tarjeta de crédito presente") for the same
 * purchase. Pure: no network, no system clock.
 */

import { normalizeForMatch } from "./categorize";
import type { ParsedEmail, RawEmail } from "./types";

/** A parsed purchase together with the email it came from. */
export interface ParsedMessage {
  raw: RawEmail;
  parsed: ParsedEmail;
}

export interface DedupeResult<T> {
  /** One message per purchase, in input order. */
  kept: T[];
  /** Repeated alerts that must not be stored, in input order. */
  dropped: T[];
}

/** Alerts whose purchase times are this close (inclusive) can be the same purchase. */
export const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

/** The alert kept when a purchase was reported several times. */
const PREFERRED_SUBJECT = normalizeForMatch("Uso de tarjeta de crédito");

interface Group<T> {
  key: string;
  time: number;
  members: Array<{ item: T; index: number; subject: string }>;
}

function purchaseKey({ cardLast4, amount, currency, merchant }: ParsedEmail): string {
  return [cardLast4, amount.toFixed(2), currency, normalizeForMatch(merchant)].join("|");
}

function receivedMs(raw: RawEmail): number {
  const ms = Date.parse(raw.date);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * Keeps one message per Scotiabank purchase. Two alerts are the same purchase when card, amount,
 * currency and merchant (case, accent and spacing insensitive) match, their times are at most
 * 2 minutes apart, and their subjects differ: Scotiabank sends each subject once per purchase,
 * so two alerts with the same subject are two real purchases. In each group the
 * "Uso de tarjeta de crédito" alert is kept if present; otherwise the first one received.
 * Messages from other banks, or with an unreadable date, are always kept.
 */
export function dedupeScotiabank<T extends ParsedMessage>(messages: readonly T[]): DedupeResult<T> {
  const groups: Group<T>[] = [];
  const byReceipt = messages
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.parsed.bank === "Scotiabank")
    .sort((a, b) => receivedMs(a.item.raw) - receivedMs(b.item.raw) || a.index - b.index);

  for (const { item, index } of byReceipt) {
    const time = Date.parse(item.parsed.date);
    if (Number.isNaN(time)) continue;
    const key = purchaseKey(item.parsed);
    const subject = normalizeForMatch(item.raw.subject);
    const group = groups.find(
      (g) =>
        g.key === key &&
        Math.abs(g.time - time) <= DUPLICATE_WINDOW_MS &&
        g.members.every((m) => m.subject !== subject),
    );
    const member = { item, index, subject };
    if (group) group.members.push(member);
    else groups.push({ key, time, members: [member] });
  }

  const droppedIndexes = new Set<number>();
  for (const { members } of groups) {
    const keep = members.find((m) => m.subject === PREFERRED_SUBJECT) ?? members[0];
    for (const m of members) if (m !== keep) droppedIndexes.add(m.index);
  }

  const result: DedupeResult<T> = { kept: [], dropped: [] };
  messages.forEach((item, index) =>
    (droppedIndexes.has(index) ? result.dropped : result.kept).push(item),
  );
  return result;
}
