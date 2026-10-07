/**
 * Core domain types shared by parsers, sync, repositories and UI.
 * See docs/parsing-spec.md for the email formats these come from.
 */

export const BANKS = ["Scotiabank", "APAP", "Banco Santa Cruz", "PayPal"] as const;
export type Bank = (typeof BANKS)[number];

export const CURRENCIES = ["DOP", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Category names in evaluation order (docs/parsing-spec.md §5), plus the fallback `Otros`. */
export const CATEGORIES = [
  "Supermercado",
  "Combustible",
  "Restaurantes",
  "Viajes",
  "Transporte",
  "Suscripciones",
  "Entretenimiento",
  "Compras online",
  "Hogar",
  "Salud",
  "Telecom",
  "Servicios",
  "Cuidado personal",
  "Licores",
  "Otros",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const DEFAULT_CATEGORY: Category = "Otros";

/** Only card purchases are tracked for now. */
export type TransactionKind = "consumo";

/** Where a transaction came from: parsed from Gmail or entered by hand. */
export type TransactionSource = "gmail" | "manual";

/** A Gmail message reduced to what the parsers need. The body is already plain text. */
export interface RawEmail {
  /** Gmail message id; the deduplication key. */
  id: string;
  threadId: string;
  /** Raw `From` header, e.g. `Scotiabank <alertas@scotiabank.com>`. */
  from: string;
  subject: string;
  /** When Gmail received the message (`internalDate`), as an ISO 8601 timestamp. */
  date: string;
  snippet: string;
  /** Plain-text body (HTML is converted to text before parsing). */
  body: string;
}

/** Output of a bank parser for an email that is a purchase. */
export interface ParsedEmail {
  gmailMessageId: string;
  /** ISO 8601 with the Dominican Republic offset, e.g. `2026-10-04T20:07:00-04:00`. */
  date: string;
  /** `YYYY-MM`, derived from `date`. */
  month: string;
  bank: Bank;
  /** Last 4 digits of the card only; never full account numbers. */
  cardLast4: string;
  amount: number;
  currency: Currency;
  /** Merchant text as it appears in the email, trimmed. */
  merchant: string;
  kind: TransactionKind;
}

/** A stored transaction: a parsed email plus the user's own edits. */
export interface Transaction extends ParsedEmail {
  id: string;
  userId: string;
  category: Category;
  /** Hidden from totals by the user; never overwritten on re-sync. */
  ignored: boolean;
  source: TransactionSource;
}
