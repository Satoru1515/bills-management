import type { Currency, ParsedEmail, RawEmail } from "@/lib/domain/types";
import {
  combineReceivedDateWithTime,
  monthOf,
  normalizeText,
  parseAmount,
  to24Hour,
} from "./shared";

/** Scotiabank alerts (`alertas@scotiabank.com`). See docs/parsing-spec.md §1. */

const PURCHASE_RE =
  /monto de \$([\d,]+\.\d{2}) (DOP|USD) en (.+?) con su (?:Tarjeta de Cr[ée]dito Scotiabank|tarjeta) \*{3}(\d{4}) a las (\d{1,2}:\d{2}) ?(am|pm)/i;

const BILL_PAYMENT_RE =
  /pago de factura desde tu Tarjeta de Cr[ée]dito por un(?:a)? cantidad de \$([\d,]+\.\d{2}) (DOP|USD) en la tarjeta \*{3}(\d{4}) a las (\d{1,2}:\d{2}) ?(am|pm)/i;

/**
 * Payments received, instant-transfer credits and digital wallet codes are not purchases.
 * Checked on the subject only: their bodies never match the purchase patterns anyway, and
 * legal footers in purchase bodies could mention these words.
 */
const IGNORED_SUBJECT_RE = /pago recibido|pago al instante|billetera digital/i;

export const BILL_PAYMENT_MERCHANT = "PAGO DE FACTURA";

/** Card verification charges (Anthropic, Amazon, ChatGPT, Apple) are not real purchases. */
function isCardVerification(amount: number, currency: Currency): boolean {
  return currency === "USD" && amount === 0.1;
}

interface Match {
  amount: string;
  currency: string;
  merchant: string;
  cardLast4: string;
  time: string;
  meridiem: string;
}

function matchText(text: string): Match | null {
  const purchase = PURCHASE_RE.exec(text);
  if (purchase) {
    const [, amount, currency, merchant, cardLast4, time, meridiem] = purchase;
    return { amount, currency, merchant, cardLast4, time, meridiem };
  }
  const bill = BILL_PAYMENT_RE.exec(text);
  if (bill) {
    const [, amount, currency, cardLast4, time, meridiem] = bill;
    return { amount, currency, merchant: BILL_PAYMENT_MERCHANT, cardLast4, time, meridiem };
  }
  return null;
}

export function parseScotiabank(raw: RawEmail): ParsedEmail | null {
  if (IGNORED_SUBJECT_RE.test(raw.subject)) return null;

  const match = matchText(normalizeText(raw.body || raw.snippet));
  if (!match) return null;

  const amount = parseAmount(match.amount);
  const currency = match.currency.toUpperCase() as Currency;
  const merchant = match.merchant.trim();
  const clock = to24Hour(match.time, match.meridiem);
  if (amount === null || !merchant || !clock) return null;
  if (isCardVerification(amount, currency)) return null;

  const date = combineReceivedDateWithTime(raw.date, clock.hour, clock.minute);
  if (!date) return null;

  return {
    gmailMessageId: raw.id,
    date,
    month: monthOf(date),
    bank: "Scotiabank",
    cardLast4: match.cardLast4,
    amount,
    currency,
    merchant,
    kind: "consumo",
  };
}
