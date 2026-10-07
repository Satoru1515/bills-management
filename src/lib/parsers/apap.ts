import type { Currency, ParsedEmail, RawEmail } from "@/lib/domain/types";
import {
  formatDrIso,
  monthOf,
  normalizeText,
  parse24HourTime,
  parseAmount,
  parseDayMonthYear,
} from "./shared";

/** APAP notifications (`no-reply@apap.com.do`). See docs/parsing-spec.md §2. */

/**
 * Only purchase notifications open with "… presenta una transacción …". Payments received,
 * payment reminders and OTP / wallet activation codes never do, so they are ignored here.
 */
const PURCHASE_RE = /presenta una transacci[óo]n/i;

const CARD_RE = /terminada en\s*[*xX]*\s*(\d{4})\b/i;

const LABELS = ["Fecha", "Hora", "Moneda", "Monto", "Comercio", "Estado", "Balance disponible"];
const LABEL_VALUE_RE = new RegExp(`^(?:${LABELS.join("|")})\\s*:`, "i");

/**
 * Reads the value of a `Label: | value` row of the detail table. The plain-text conversion
 * may separate the cells with `|`, spaces or a line break, so all of those are accepted.
 */
function field(body: string, label: string): string | null {
  const re = new RegExp(`(?<!\\p{L})${label}\\s*:[\\s|]*([^|\\n]+)`, "iu");
  const value = re.exec(body)?.[1];
  if (value === undefined) return null;
  const cleaned = normalizeText(value);
  // An empty cell would otherwise swallow the next row's label.
  if (!cleaned || LABEL_VALUE_RE.test(cleaned)) return null;
  return cleaned;
}

function parseCurrency(text: string): Currency | null {
  if (/pesos|\bRD\b|\bDOP\b/i.test(text)) return "DOP";
  if (/d[óo]lar|\bUS\b|\bUSD\b/i.test(text)) return "USD";
  return null;
}

function isApproved(status: string): boolean {
  return /\baprobada\b/i.test(status) && !/\bno aprobada\b/i.test(status);
}

export function parseApap(raw: RawEmail): ParsedEmail | null {
  // The table rows are needed, so the one-line snippet is not a usable fallback here.
  const body = raw.body.replace(/\r\n?/g, "\n").replace(/ /g, " ");
  const text = normalizeText(body);
  if (!PURCHASE_RE.test(text)) return null;

  const cardLast4 = CARD_RE.exec(text)?.[1];
  const status = field(body, "Estado");
  if (!cardLast4 || !status || !isApproved(status)) return null;

  const day = parseDayMonthYear(field(body, "Fecha") ?? "");
  const time = parse24HourTime(field(body, "Hora") ?? "");
  const currency = parseCurrency(field(body, "Moneda") ?? "");
  const amount = parseAmount((field(body, "Monto") ?? "").replace(/^(?:RD|US)?\$\s*/i, ""));
  const merchant = field(body, "Comercio");
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
