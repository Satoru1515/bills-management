/**
 * Pure helpers that turn a Gmail API message (`users.messages.get`, `format=full`) into the
 * {@link RawEmail} the parsers read. No network: attachment bodies are fetched by the client
 * before {@link toRawEmail} runs.
 */

import type { RawEmail } from "@/lib/domain/types";

/** A MIME part as returned by the Gmail API. */
export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailPartBody;
  parts?: GmailMessagePart[];
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPartBody {
  /** Set when the content is too large to inline; fetch it with `messages.attachments.get`. */
  attachmentId?: string;
  size?: number;
  /** Content bytes (transfer encoding already removed), base64url. */
  data?: string;
}

/** The fields of a Gmail API message that are used here. */
export interface GmailMessage {
  id: string;
  threadId: string;
  /** Milliseconds since the epoch, as a string. */
  internalDate?: string;
  /** HTML-escaped preview text. */
  snippet?: string;
  payload?: GmailMessagePart;
}

/** Value of the first header with this name (case-insensitive), with MIME encoded-words decoded. */
export function headerValue(headers: readonly GmailHeader[] | undefined, name: string): string {
  const lower = name.toLowerCase();
  const header = headers?.find((h) => h.name.toLowerCase() === lower);
  return header ? decodeMimeWords(header.value).trim() : "";
}

/** Decodes RFC 2047 encoded-words (`=?UTF-8?B?…?=`, `=?ISO-8859-1?Q?…?=`) in a header value. */
export function decodeMimeWords(value: string): string {
  return (
    value
      // Whitespace between two adjacent encoded-words is not part of the text.
      .replace(/(\?=)\s+(?==\?)/g, "$1")
      .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (word, charset: string, enc: string, text) => {
        try {
          const bytes =
            enc.toUpperCase() === "B"
              ? Buffer.from(text, "base64")
              : Buffer.from(
                  text
                    .replace(/_/g, " ")
                    .replace(/=([0-9A-Fa-f]{2})/g, (_: string, hex: string) =>
                      String.fromCharCode(parseInt(hex, 16)),
                    ),
                  "latin1",
                );
          return decodeBytes(bytes, charset);
        } catch {
          return word;
        }
      })
  );
}

/** Decodes Gmail's base64url body data (either base64 alphabet, padding optional) as text. */
export function decodeBase64Url(data: string, charset = "utf-8"): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  return decodeBytes(Buffer.from(base64, "base64"), charset);
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const label = charset.trim().toLowerCase() || "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // Unknown charset label: UTF-8 is the best guess.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** The `charset` parameter of a part's Content-Type header, or utf-8. */
export function partCharset(part: GmailMessagePart): string {
  const contentType = headerValue(part.headers, "Content-Type");
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
  return match?.[1] ?? "utf-8";
}

/** True for a part that is an attached file rather than the message text. */
function isAttachment(part: GmailMessagePart): boolean {
  if (part.filename) return true;
  return /^\s*attachment\b/i.test(headerValue(part.headers, "Content-Disposition"));
}

/**
 * The first `text/plain` and first `text/html` parts of the message, in MIME tree order,
 * skipping attached files.
 */
export function findTextParts(payload: GmailMessagePart | undefined): {
  plain: GmailMessagePart | null;
  html: GmailMessagePart | null;
} {
  let plain: GmailMessagePart | null = null;
  let html: GmailMessagePart | null = null;
  const visit = (part: GmailMessagePart) => {
    const type = (part.mimeType ?? "").toLowerCase();
    if (type.startsWith("multipart/")) {
      for (const child of part.parts ?? []) visit(child);
      return;
    }
    if (isAttachment(part)) return;
    if (type === "text/plain" && !plain) plain = part;
    else if (type === "text/html" && !html) html = part;
  };
  if (payload) visit(payload);
  return { plain, html };
}

/** Text parts whose content is not inline and must be fetched before {@link messageBody}. */
export function partsNeedingAttachment(payload: GmailMessagePart | undefined): GmailMessagePart[] {
  const { plain, html } = findTextParts(payload);
  return [plain, html].filter(
    (part): part is GmailMessagePart =>
      part !== null && !part.body?.data && Boolean(part.body?.attachmentId),
  );
}

/** Decoded text of a part, or null if it has no inline data. */
function partText(part: GmailMessagePart | null): string | null {
  const data = part?.body?.data;
  return part && data ? decodeBase64Url(data, partCharset(part)) : null;
}

/**
 * Plain-text body of the message: the `text/plain` part if it has any text, otherwise the
 * `text/html` part converted with {@link htmlToText}. Empty string if there is neither.
 */
export function messageBody(payload: GmailMessagePart | undefined): string {
  const { plain, html } = findTextParts(payload);
  const text = partText(plain);
  if (text !== null && text.trim()) return text.replace(/\r\n?/g, "\n").trim();
  const markup = partText(html);
  return markup === null ? "" : htmlToText(markup);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  ntilde: "ñ",
  Ntilde: "Ñ",
  uuml: "ü",
  Uuml: "Ü",
  agrave: "à",
  egrave: "è",
  ccedil: "ç",
  iexcl: "¡",
  iquest: "¿",
  ordf: "ª",
  ordm: "º",
  deg: "°",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  cent: "¢",
  pound: "£",
  middot: "·",
  bull: "•",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  shy: "",
  zwnj: "",
  zwj: "",
};

/** Decodes named (common ones), decimal and hex HTML entities; unknown entities are kept. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#")) {
      const code =
        name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity;
    }
    return NAMED_ENTITIES[name] ?? entity;
  });
}

const BLOCK_TAGS =
  "p|div|tr|table|tbody|thead|tfoot|h[1-6]|li|ul|ol|blockquote|center|section|article|header|footer|hr|dl|dt|dd|pre";

/**
 * Converts an HTML email to plain text lines. Table cells are separated by ` | ` (the format
 * the parsers expect for label/value tables), block elements and `<br>` become line breaks,
 * empty cells and blank lines from layout markup are dropped and whitespace is collapsed
 * within each line.
 */
export function htmlToText(html: string): string {
  const withoutTags = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, " | ")
    .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n")
    .replace(/<[^>]*>/g, "");

  return decodeHtmlEntities(withoutTags)
    .replace(/[\u200b-\u200d\u2060\ufeff\u034f\u00ad]/g, "")
    .split(/\r\n?|\n/)
    .map((line) =>
      line
        .split("|")
        .map((cell) => cell.replace(/[\s\u00a0]+/g, " ").trim())
        .filter(Boolean)
        .join(" | "),
    )
    .filter(Boolean)
    .join("\n");
}

/** ISO 8601 receive time from `internalDate`, falling back to the `Date` header; "" if neither. */
function receivedAt(message: GmailMessage): string {
  const internal = Number(message.internalDate);
  if (message.internalDate && Number.isFinite(internal)) return new Date(internal).toISOString();
  const header = Date.parse(headerValue(message.payload?.headers, "Date"));
  return Number.isNaN(header) ? "" : new Date(header).toISOString();
}

/** Converts a full Gmail API message (with text bodies inline) to a {@link RawEmail}. */
export function toRawEmail(message: GmailMessage): RawEmail {
  const headers = message.payload?.headers;
  return {
    id: message.id,
    threadId: message.threadId,
    from: headerValue(headers, "From"),
    subject: headerValue(headers, "Subject"),
    date: receivedAt(message),
    snippet: decodeHtmlEntities(message.snippet ?? "").trim(),
    body: messageBody(message.payload),
  };
}
