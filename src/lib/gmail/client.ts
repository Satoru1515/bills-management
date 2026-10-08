/**
 * Minimal Gmail API client (read-only) over `fetch`. Server-only: it holds the user's
 * decrypted refresh token and the OAuth client secret.
 *
 * - Access tokens come from the refresh token (`grant_type=refresh_token`) and are cached
 *   until shortly before they expire.
 * - `listMessages` returns the ids of every message matching a Gmail search (all pages).
 *   Gmail matches messages one by one, so every notification inside a thread is listed.
 * - `getMessage` returns the message as a {@link RawEmail} with a plain-text body.
 *
 * `fetch` and the clock are injectable so tests never touch the network.
 */

import type { RawEmail } from "@/lib/domain/types";
import { formatDrIso, toDrParts } from "@/lib/parsers/shared";
import {
  partsNeedingAttachment,
  toRawEmail,
  type GmailMessage,
  type GmailMessagePart,
} from "./mime";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Refresh the access token this long before Google says it expires. */
const EXPIRY_MARGIN_MS = 60 * 1000;
/** Gmail's maximum page size for `messages.list`. */
const PAGE_SIZE = 500;
/** Default cap on listed messages, so a bad query cannot page through a whole mailbox. */
const DEFAULT_MAX_MESSAGES = 2000;

/** The subset of a `fetch` response that the client uses. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type HttpFetch = (
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * A Google OAuth or Gmail API call failed. `reconnectRequired` means the stored refresh token
 * no longer works (revoked, expired or missing the Gmail scope): the user must sign in again.
 * Messages never include tokens or secrets.
 */
export class GmailError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null = null,
    readonly reconnectRequired = false,
  ) {
    super(message);
    this.name = "GmailError";
  }
}

export interface AccessToken {
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** OAuth client id and secret from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. */
export function googleOAuthCredentials(): GoogleOAuthCredentials {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId) throw new Error(missingEnv("GOOGLE_CLIENT_ID"));
  if (!clientSecret) throw new Error(missingEnv("GOOGLE_CLIENT_SECRET"));
  return { clientId, clientSecret };
}

function missingEnv(name: string): string {
  return `Missing environment variable ${name}; copy .env.example to .env.local.`;
}

const defaultFetch: HttpFetch = (url, init) => fetch(url, init);

/** Exchanges a refresh token for a new access token. */
export async function refreshAccessToken(
  credentials: GoogleOAuthCredentials,
  refreshToken: string,
  options: { fetch?: HttpFetch; now?: () => number } = {},
): Promise<AccessToken> {
  const doFetch = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  }).toString();

  const response = await doFetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await readJson(response);

  if (!response.ok) {
    const code = typeof json?.error === "string" ? json.error : null;
    // invalid_grant: the refresh token was revoked or expired (7 days in Testing mode).
    throw new GmailError(
      `Google token refresh failed (${response.status}${code ? ` ${code}` : ""})`,
      response.status,
      code,
      code === "invalid_grant",
    );
  }
  const token = json?.access_token;
  const expiresIn = Number(json?.expires_in);
  if (typeof token !== "string" || !token) {
    throw new GmailError("Google token response has no access_token", response.status);
  }
  return {
    token,
    expiresAt: now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
  };
}

/**
 * Gmail search date for messages received after `after`, as `YYYY/MM/DD` in Dominican
 * Republic time (docs/parsing-spec.md §6). Gmail compares whole days, so callers subtract a
 * day of margin and rely on `gmail_message_id` to skip what was already stored.
 */
export function gmailSearchDate(after: Date | string): string {
  const iso = typeof after === "string" ? after : after.toISOString();
  const parts = toDrParts(iso);
  if (!parts) throw new RangeError(`Invalid date for a Gmail search: ${iso}`);
  return formatDrIso(parts).slice(0, 10).replace(/-/g, "/");
}

/** Appends `after:YYYY/MM/DD` to a Gmail search query when `after` is given. */
export function withAfter(query: string, after?: Date | string | null): string {
  const trimmed = query.trim();
  return after ? `${trimmed} after:${gmailSearchDate(after)}`.trim() : trimmed;
}

export interface MessageRef {
  id: string;
  threadId: string;
}

export interface GmailClient {
  /** Ids of every message matching `query` (optionally received after `after`), newest first. */
  listMessages(
    query: string,
    after?: Date | string | null,
    options?: { maxMessages?: number },
  ): Promise<MessageRef[]>;
  /** The message with a plain-text body (text/plain preferred, otherwise HTML converted). */
  getMessage(id: string): Promise<RawEmail>;
}

export interface GmailClientOptions {
  credentials: GoogleOAuthCredentials;
  refreshToken: string;
  fetch?: HttpFetch;
  now?: () => number;
}

export function createGmailClient(options: GmailClientOptions): GmailClient {
  const doFetch = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;
  let cached: AccessToken | null = null;

  async function accessToken(forceRefresh: boolean): Promise<string> {
    if (forceRefresh || !cached || cached.expiresAt - EXPIRY_MARGIN_MS <= now()) {
      cached = await refreshAccessToken(options.credentials, options.refreshToken, {
        fetch: doFetch,
        now,
      });
    }
    return cached.token;
  }

  /** GET on the Gmail API; a 401 refreshes the access token and retries once. */
  async function get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const query = new URLSearchParams(params).toString();
    const url = `${GMAIL_API_URL}${path}${query ? `?${query}` : ""}`;
    for (let attempt = 0; ; attempt++) {
      const token = await accessToken(attempt > 0);
      const response = await doFetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (response.status === 401 && attempt === 0) continue;
      const json = await readJson(response);
      if (!response.ok) throw apiError(response.status, json);
      return json;
    }
  }

  return {
    async listMessages(query, after, listOptions = {}) {
      const max = listOptions.maxMessages ?? DEFAULT_MAX_MESSAGES;
      const q = withAfter(query, after);
      const refs: MessageRef[] = [];
      let pageToken: string | undefined;
      do {
        const params: Record<string, string> = {
          q,
          maxResults: String(Math.min(PAGE_SIZE, max - refs.length)),
        };
        if (pageToken) params.pageToken = pageToken;
        const page = (await get("/messages", params)) as {
          messages?: MessageRef[];
          nextPageToken?: string;
        } | null;
        for (const ref of page?.messages ?? []) {
          if (refs.length >= max) break;
          refs.push({ id: ref.id, threadId: ref.threadId });
        }
        pageToken = page?.nextPageToken;
      } while (pageToken && refs.length < max);
      return refs;
    },

    async getMessage(id) {
      const encoded = encodeURIComponent(id);
      const message = (await get(`/messages/${encoded}`, { format: "full" })) as GmailMessage;
      for (const part of partsNeedingAttachment(message.payload)) {
        await loadAttachment(encoded, part);
      }
      return toRawEmail(message);
    },
  };

  /** Fills `part.body.data` from `messages.attachments.get` (large text bodies). */
  async function loadAttachment(encodedId: string, part: GmailMessagePart): Promise<void> {
    const attachmentId = encodeURIComponent(part.body!.attachmentId!);
    const attachment = (await get(`/messages/${encodedId}/attachments/${attachmentId}`)) as {
      data?: string;
    } | null;
    part.body = { ...part.body, data: attachment?.data ?? "" };
  }
}

/** Parses a JSON response body; null if it is empty or not JSON. */
async function readJson(response: HttpResponse): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Builds a GmailError from a Gmail API error body (`{ error: { code, message, status, errors } }`). */
function apiError(status: number, json: Record<string, unknown> | null): GmailError {
  const error = (json?.error ?? null) as {
    message?: unknown;
    status?: unknown;
    errors?: { reason?: unknown }[];
  } | null;
  const reason = error?.errors?.[0]?.reason;
  const code =
    typeof reason === "string" ? reason : typeof error?.status === "string" ? error.status : null;
  const detail = typeof error?.message === "string" ? `: ${error.message}` : "";
  // 401 after a fresh token, or 403 for a missing scope: the grant itself is not usable.
  // Other 403s (rate limits, quota) are temporary and keep the connection.
  const reconnect =
    status === 401 || (status === 403 && /insufficient|scope/i.test(`${code} ${detail}`));
  return new GmailError(`Gmail API request failed (${status})${detail}`, status, code, reconnect);
}
