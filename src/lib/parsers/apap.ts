import type { Currency, ParsedEmail, RawEmail } from "@/lib/domain/types";
import {
  CARD_ENDING_RE,
  formatDrIso,
  isApprovedStatus,
  monthOf,
  normalizeText,
  parse24HourTime,
  parseAmountWithPrefix,
  parseDayMonthYear,
  readField,
  toPlainLines,
} from "./shared";

/** APAP notifications (`no-reply@apap.com.do`). See docs/parsing-spec.md §2. */

/**
 * Only purchase notifications open with "… presenta una transacción …". Payments received,
 * payment reminders and OTP / wallet activation codes never do, so they are ignored here.
 */
const PURCHASE_RE = /presenta una transacci[óo]n/i;

const LABELS = ["Fecha", "Hora", "Moneda", "Monto", "Comercio", "Estado", "Balance disponible"];

function parseCurrency(text: string): Currency | null {
  if (/pesos|\bRD\b|\bDOP\b/i.test(text)) return "DOP";
  if (/d[óo]lar|\bUS\b|\bUSD\b/i.test(text)) return "USD";
  return null;
}

export function parseApap(raw: RawEmail): ParsedEmail | null {
  // The table rows are needed, so the one-line snippet is not a usable fallback here.
  const body = toPlainLines(raw.body);
  const text = normalizeText(body);
  if (!PURCHASE_RE.test(text)) return null;

  const field = (label: string) => readField(body, label, LABELS);
  const cardLast4 = CARD_ENDING_RE.exec(text)?.[1];
  const status = field("Estado");
  if (!cardLast4 || !status || !isApprovedStatus(status)) return null;

  const day = parseDayMonthYear(field("Fecha") ?? "");
  const time = parse24HourTime(field("Hora") ?? "");
  const currency = parseCurrency(field("Moneda") ?? "");
  const amount = parseAmountWithPrefix(field("Monto") ?? "");
  const merchant = field("Comercio");
  if (!day || !time || !currency || amount === null || !merchant) return null;

  const date = formatDrIso({ ...day, ...time });
  return {
    gmailMessageId: raw.id,
    date,
    month: monthOf(date),
    bank: "APAP",
    cardLast4,
    amount,
    currency,
    merchant,
    kind: "consumo",
  };
}
