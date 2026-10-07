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

/** Banco Santa Cruz notifications (`notificaciones@bsc.com.do`). See docs/parsing-spec.md §3. */

/**
 * Purchases are headed "NOTIFICACIÓN DE consumo". Transfers received, card payments and
 * cashback refunds carry other headings, so they are ignored here.
 */
const PURCHASE_RE = /notificaci[óo]n de consumo/i;

const LABELS = ["Monto", "Lugar de transacci[óo]n", "Fecha y hora", "Estado"];

function currencyOf(amountText: string): Currency | null {
  if (/^RD\$/i.test(amountText)) return "DOP";
  if (/^US\$/i.test(amountText)) return "USD";
  return null;
}

/** Parses `d/m/yyyy HH:MM:SS` in Dominican Republic time. */
function parseDateTime(text: string): string | null {
  const [dayText, timeText, ...rest] = text.split(" ");
  if (!dayText || !timeText || rest.length > 0) return null;
  const day = parseDayMonthYear(dayText);
  const time = parse24HourTime(timeText);
  return day && time ? formatDrIso({ ...day, ...time }) : null;
}

export function parseBsc(raw: RawEmail): ParsedEmail | null {
  // The labeled rows are needed, so the one-line snippet is not a usable fallback here.
  const body = toPlainLines(raw.body);
  // "terminada en" may be split across two lines, so the card is read from the flattened text.
  const text = normalizeText(body);
  if (!PURCHASE_RE.test(text)) return null;

  const field = (label: string) => readField(body, label, LABELS);
  const cardLast4 = CARD_ENDING_RE.exec(text)?.[1];
  const status = field("Estado");
  if (!cardLast4 || !status || !isApprovedStatus(status)) return null;

  const amountText = field("Monto") ?? "";
  const currency = currencyOf(amountText);
  const amount = parseAmountWithPrefix(amountText);
  const merchant = field("Lugar de transacci[óo]n");
  const date = parseDateTime(field("Fecha y hora") ?? "");
  if (!currency || amount === null || !merchant || !date) return null;

  return {
    gmailMessageId: raw.id,
    date,
    month: monthOf(date),
    bank: "Banco Santa Cruz",
    cardLast4,
    amount,
    currency,
    merchant,
    kind: "consumo",
  };
}
