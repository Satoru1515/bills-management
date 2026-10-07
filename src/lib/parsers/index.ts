import type { ParsedEmail, RawEmail } from "@/lib/domain/types";
import { parseApap } from "./apap";
import { parseBsc } from "./bsc";
import { parsePaypal } from "./paypal";
import { parseScotiabank } from "./scotiabank";

/** Entry point of the parsers: picks the bank parser by the sender's address. */

export type EmailParser = (raw: RawEmail) => ParsedEmail | null;

/** The only senders that are read (CLAUDE.md), keyed by lower-case address. */
export const PARSERS_BY_SENDER: ReadonlyMap<string, EmailParser> = new Map([
  ["alertas@scotiabank.com", parseScotiabank],
  ["no-reply@apap.com.do", parseApap],
  ["notificaciones@bsc.com.do", parseBsc],
  ["service@intl.paypal.com", parsePaypal],
]);

/**
 * Lower-case address of a `From` header: `Scotiabank <alertas@scotiabank.com>` or a bare
 * address. The address inside `<…>` wins, so a display name that looks like an address
 * (`"alertas@scotiabank.com" <someone@else.com>`) is never trusted.
 */
export function senderAddress(from: string): string | null {
  const bracketed = /<([^<>]+)>\s*$/.exec(from.trim())?.[1];
  const address = (bracketed ?? from).trim().toLowerCase();
  return /^[^\s@<>"]+@[^\s@<>"]+$/.test(address) ? address : null;
}

/** Parses an email from one of the known senders; null for any other sender or non-purchase. */
export function parseEmail(raw: RawEmail): ParsedEmail | null {
  const address = senderAddress(raw.from);
  const parse = address ? PARSERS_BY_SENDER.get(address) : undefined;
  return parse ? parse(raw) : null;
}
