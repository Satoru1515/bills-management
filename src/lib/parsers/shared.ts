/**
 * Pure helpers shared by the bank parsers. No network, no system clock.
 * All dates are expressed in Dominican Republic time (UTC-4, no daylight saving).
 */

export const DR_OFFSET = "-04:00";
const DR_OFFSET_MS = -4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Collapses every run of whitespace (including non-breaking spaces and line breaks) to one space. */
export function normalizeText(text: string): string {
  return text.replace(/[\s ]+/g, " ").trim();
}

/** Parses an amount such as `5,986.90` or `920.00`. Returns null when it is not a valid amount. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Converts a 12-hour clock time (`07:35`, `pm`) to 24-hour hours and minutes. */
export function to24Hour(time: string, meridiem: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const isPm = meridiem.trim().toLowerCase() === "pm";
  const hour = (hour12 % 12) + (isPm ? 12 : 0);
  return { hour, minute };
}

export interface DrDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Formats local Dominican Republic date parts as ISO 8601 with the `-04:00` offset. */
export function formatDrIso(parts: DrDateParts): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` +
    `T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}${DR_OFFSET}`
  );
}

/** `YYYY-MM` of an ISO date produced by {@link formatDrIso}. */
export function monthOf(drIso: string): string {
  return drIso.slice(0, 7);
}

/** Converts any ISO 8601 timestamp to Dominican Republic local date parts. Null if unparseable. */
export function toDrParts(iso: string): DrDateParts | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const local = new Date(ms + DR_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
  };
}

/**
 * Combines the day an email was received with the time of day stated in its text.
 * If that time would be later than the reception (a purchase just before midnight
 * notified just after it), the previous day is used. A few minutes of tolerance
 * cover clock differences between the bank and Gmail.
 */
export function combineReceivedDateWithTime(
  receivedIso: string,
  hour: number,
  minute: number,
  toleranceMinutes = 10,
): string | null {
  const received = toDrParts(receivedIso);
  if (!received) return null;
  const receivedMs = Date.parse(receivedIso);
  let candidateMs =
    Date.UTC(received.year, received.month - 1, received.day, hour, minute) - DR_OFFSET_MS;
  if (candidateMs - receivedMs > toleranceMinutes * 60 * 1000) candidateMs -= DAY_MS;
  const parts = toDrParts(new Date(candidateMs).toISOString());
  return parts ? formatDrIso(parts) : null;
}

/** Parses a `d/m/yyyy` date (`4/10/2026` = 4 October 2026). Null if it is not a real calendar day. */
export function parseDayMonthYear(
  text: string,
): Pick<DrDateParts, "year" | "month" | "day"> | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Parses a 24-hour time with optional seconds and no leading zeros required (`20:7` = 20:07). */
export function parse24HourTime(
  text: string,
): Pick<DrDateParts, "hour" | "minute" | "second"> | null {
  const match = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

/** Normalizes line endings to `\n` and non-breaking spaces to plain spaces, keeping the lines. */
export function toPlainLines(body: string): string {
  return body.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
}

/**
 * Reads the value of a `Label: value` row from a plain-text body (see {@link toPlainLines}).
 * HTML tables may come out with the cells separated by `|`, spaces or a line break, so all of
 * those are accepted between the label and its value. `label` is a regex source; `knownLabels`
 * are the other labels of the same email, so an empty cell never returns the next row's label.
 */
export function readField(
  body: string,
  label: string,
  knownLabels: readonly string[],
): string | null {
  const re = new RegExp(`(?<!\\p{L})${label}\\s*:[\\s|]*([^|\\n]+)`, "iu");
  const value = re.exec(body)?.[1];
  if (value === undefined) return null;
  const cleaned = normalizeText(value);
  const nextLabel = new RegExp(`^(?:${knownLabels.join("|")})\\s*:`, "iu");
  if (!cleaned || nextLabel.test(cleaned)) return null;
  return cleaned;
}

/** Strips an `RD$` / `US$` / `$` prefix and parses the amount. */
export function parseAmountWithPrefix(text: string): number | null {
  return parseAmount(text.replace(/^(?:RD|US)?\$\s*/i, ""));
}

/** Last 4 card digits after "terminada en" (optionally masked, e.g. `terminada en ****5977`). */
export const CARD_ENDING_RE = /terminada en\s*[*xX]*\s*(\d{4})\b/i;

/** True for statuses such as `Aprobada` or `Transacción Aprobada`, false for `No Aprobada`. */
export function isApprovedStatus(status: string): boolean {
  return /\baprobada\b/i.test(status) && !/\bno aprobada\b/i.test(status);
}
