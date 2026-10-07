import type { Currency, ParsedEmail, RawEmail } from "@/lib/domain/types";
import {
  formatDrIso,
  monthOf,
  normalizeText,
  parseAmount,
  toDrParts,
  toPlainLines,
} from "./shared";

/** PayPal payment receipts (`service@intl.paypal.com`). See docs/parsing-spec.md §4. */

/** Only receipts for payments sent ("Receipt for Your Payment to …") are purchases. */
const RECEIPT_SUBJECT_RE = /\breceipt\b/i;

/**
 * "You paid $11.99 USD to Spotify AB". Recurring payments word it as
 * "You sent an automatic payment of $11.99 USD to Spotify AB". The merchant runs to the end
 * of the line; money received, refunds and promotions never contain these phrases.
 */
const PAYMENT_RE =
  /You (?:paid|sent an automatic payment of)\s+(?:US\$|RD\$|\$)?\s*([\d,]+(?:\.\d{1,2})?)\s+([A-Z]{3})\s+to\s+([^\n]+)/i;

/** When the HTML is flattened to one line, the merchant is followed by the next labels. */
const MERCHANT_END_RE = /(?:^|\s+)(?:Transaction ID|Transaction date|Merchant)\b.*$/i;

const SUBJECT_MERCHANT_RE = /Receipt for your payment to\s+(.+)$/i;

/** "Transaction date 4 Oct 2026" (spec) or "Transaction date Oct 4, 2026"; `:` / `|` allowed. */
const DATE_DMY_RE = /Transaction date[\s:|]*(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/i;
const DATE_MDY_RE = /Transaction date[\s:|]*([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/i;

/** Card used, e.g. `Visa-7782` or `Mastercard - 1234`. Paying from the PayPal balance has none. */
const CARD_RE = /\b(?:Visa|Mastercard|Master Card|American Express|Amex|Discover)\s*-\s*(\d{4})\b/i;
const NO_CARD = "0000";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Month number for an English name or abbreviation (`Oct`, `Sept`, `October`). */
function monthNumber(name: string): number | null {
  const lower = name.toLowerCase();
  if (lower.length < 3) return null;
  const index = MONTHS.findIndex((month) => month.startsWith(lower));
  return index === -1 ? null : index + 1;
}

function calendarDay(day: number, monthName: string, year: number) {
  const month = monthNumber(monthName);
  if (month === null) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/**
 * Day from "Transaction date" with the time of day the email was received (PayPal does not
 * state the time). Without a "Transaction date" line the reception date is used as a whole;
 * a line that is present but unreadable makes the email unparseable.
 */
function parseDate(text: string, receivedIso: string): string | null {
  const received = toDrParts(receivedIso);
  if (!received) return null;
  const time = { hour: received.hour, minute: received.minute, second: received.second };

  const dmy = DATE_DMY_RE.exec(text);
  if (dmy) {
    const [, day, monthName, year] = dmy;
    const parts = calendarDay(Number(day), monthName, Number(year));
    return parts ? formatDrIso({ ...parts, ...time }) : null;
  }
  const mdy = DATE_MDY_RE.exec(text);
  if (mdy) {
    const [, monthName, day, year] = mdy;
    const parts = calendarDay(Number(day), monthName, Number(year));
    return parts ? formatDrIso({ ...parts, ...time }) : null;
  }
  if (/Transaction date/i.test(text)) return null;
  return formatDrIso(received);
}

/**
 * The merchant from the body; the subject's name wins when both differ only by the period that
 * ends the body's sentence ("… to Netflix International B.V." keeps its own final period).
 */
function pickMerchant(bodyText: string, subject: string): string {
  const fromBody = normalizeText(bodyText.replace(MERCHANT_END_RE, ""));
  const fromSubject = normalizeText(SUBJECT_MERCHANT_RE.exec(subject)?.[1] ?? "");
  const withoutPeriod = (name: string) => name.replace(/\.$/, "");
  if (fromSubject && withoutPeriod(fromBody) === withoutPeriod(fromSubject)) return fromSubject;
  return fromBody || fromSubject;
}

function currencyOf(code: string): Currency | null {
  const upper = code.toUpperCase();
  return upper === "USD" || upper === "DOP" ? upper : null;
}

export function parsePaypal(raw: RawEmail): ParsedEmail | null {
  if (!RECEIPT_SUBJECT_RE.test(raw.subject)) return null;
  // The card line is at the end of the receipt, so the snippet is not a usable fallback.
  const body = toPlainLines(raw.body);
  const payment = PAYMENT_RE.exec(body);
  if (!payment) return null;

  const [, amountText, currencyCode, merchantText] = payment;
  const amount = parseAmount(amountText);
  const currency = currencyOf(currencyCode);
  const merchant = pickMerchant(merchantText, raw.subject);

  const text = normalizeText(body);
  const date = parseDate(text, raw.date);
  if (amount === null || !currency || !merchant || !date) return null;

  return {
    gmailMessageId: raw.id,
    date,
    month: monthOf(date),
    bank: "PayPal",
    cardLast4: CARD_RE.exec(text)?.[1] ?? NO_CARD,
    amount,
    currency,
    merchant,
    kind: "consumo",
  };
}
