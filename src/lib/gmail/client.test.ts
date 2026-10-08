import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEmail } from "@/lib/parsers";
import {
  PAYPAL_ATTACHMENT_ID,
  PAYPAL_TEXT,
  apapHtmlOnly,
  b64url,
  paypalBodyAsAttachment,
} from "./__fixtures__/messages";
import {
  GMAIL_API_URL,
  GOOGLE_TOKEN_URL,
  GmailError,
  createGmailClient,
  gmailSearchDate,
  googleOAuthCredentials,
  refreshAccessToken,
  withAfter,
  type HttpFetch,
  type HttpResponse,
} from "./client";

// Test-only values; never real credentials.
const CREDENTIALS = { clientId: "test-client.apps.googleusercontent.com", clientSecret: "shh" };
const REFRESH_TOKEN = "1//0test-refresh-token";
const T0 = Date.parse("2026-10-07T12:00:00.000Z");

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

type Handler = (call: Call) => { status?: number; json?: unknown } | undefined;

/** A fake fetch that records every call and answers from `handler` (404 if it returns nothing). */
function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const fetch: HttpFetch = async (url, init) => {
    const call = { url, ...init };
    calls.push(call);
    const reply = handler(call) ?? { status: 404, json: { error: { message: "Not Found" } } };
    const status = reply.status ?? 200;
    const response: HttpResponse = {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (reply.json === undefined ? "" : JSON.stringify(reply.json)),
    };
    return response;
  };
  return { fetch, calls };
}

let tokenCount = 0;
function tokenReply(expiresIn = 3599) {
  tokenCount += 1;
  return { json: { access_token: `ya29.test-${tokenCount}`, expires_in: expiresIn } };
}

function isToken(call: Call) {
  return call.url === GOOGLE_TOKEN_URL;
}

function apiCalls(calls: Call[]) {
  return calls.filter((c) => !isToken(c));
}

afterEach(() => {
  tokenCount = 0;
  vi.unstubAllEnvs();
});

describe("refreshAccessToken", () => {
  it("posts the refresh grant as a form and returns the token with its expiry", async () => {
    const { fetch, calls } = fakeFetch(() => tokenReply(3600));
    const token = await refreshAccessToken(CREDENTIALS, REFRESH_TOKEN, { fetch, now: () => T0 });

    expect(token).toEqual({ token: "ya29.test-1", expiresAt: T0 + 3600 * 1000 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toEqual({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
      client_id: CREDENTIALS.clientId,
      client_secret: CREDENTIALS.clientSecret,
    });
  });

  it("flags invalid_grant as needing a reconnect, without leaking the token", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 400,
      json: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
    }));
    const error = await refreshAccessToken(CREDENTIALS, REFRESH_TOKEN, { fetch }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GmailError);
    expect(error).toMatchObject({ status: 400, code: "invalid_grant", reconnectRequired: true });
    expect(String((error as Error).message)).not.toContain(REFRESH_TOKEN);
    expect(String((error as Error).message)).not.toContain(CREDENTIALS.clientSecret);
  });

  it("treats other failures as temporary", async () => {
    const { fetch } = fakeFetch(() => ({ status: 503 }));
    await expect(refreshAccessToken(CREDENTIALS, REFRESH_TOKEN, { fetch })).rejects.toMatchObject({
      status: 503,
      code: null,
      reconnectRequired: false,
    });
  });

  it("rejects a response without an access token", async () => {
    const { fetch } = fakeFetch(() => ({ json: { expires_in: 3600 } }));
    await expect(refreshAccessToken(CREDENTIALS, REFRESH_TOKEN, { fetch })).rejects.toThrow(
      "no access_token",
    );
  });
});

describe("gmailSearchDate / withAfter", () => {
  it("formats the Dominican Republic day of the instant", () => {
    expect(gmailSearchDate("2026-10-06T12:00:00.000Z")).toBe("2026/10/06");
    // 02:00 UTC on 7 Oct is still 6 Oct (22:00) in DR time.
    expect(gmailSearchDate(new Date("2026-10-07T02:00:00.000Z"))).toBe("2026/10/06");
    expect(() => gmailSearchDate("not a date")).toThrow(RangeError);
  });

  it("appends after: only when a date is given", () => {
    const query = "from:no-reply@apap.com.do";
    expect(withAfter(query, "2026-10-06T12:00:00Z")).toBe(`${query} after:2026/10/06`);
    expect(withAfter(` ${query} `, null)).toBe(query);
    expect(withAfter(query)).toBe(query);
  });
});

describe("googleOAuthCredentials", () => {
  it("reads and trims the client id and secret", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", " id.apps.googleusercontent.com ");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    expect(googleOAuthCredentials()).toEqual({
      clientId: "id.apps.googleusercontent.com",
      clientSecret: "secret",
    });
  });

  it("names the missing variable", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", " ");
    expect(() => googleOAuthCredentials()).toThrow("GOOGLE_CLIENT_SECRET");
  });
});

describe("createGmailClient", () => {
  function client(handler: Handler, now = () => T0) {
    const fake = fakeFetch(handler);
    const gmail = createGmailClient({
      credentials: CREDENTIALS,
      refreshToken: REFRESH_TOKEN,
      fetch: fake.fetch,
      now,
    });
    return { gmail, calls: fake.calls };
  }

  describe("listMessages", () => {
    it("pages through the results with the bearer token and the after: query", async () => {
      const { gmail, calls } = client((call) => {
        if (isToken(call)) return tokenReply();
        const page = new URL(call.url).searchParams.get("pageToken");
        if (!page) {
          return {
            json: {
              messages: [
                { id: "m1", threadId: "t1" },
                { id: "m2", threadId: "t1" },
              ],
              nextPageToken: "p2",
            },
          };
        }
        return { json: { messages: [{ id: "m3", threadId: "t3" }] } };
      });

      const refs = await gmail.listMessages(
        "from:no-reply@apap.com.do",
        "2026-10-06T12:00:00.000Z",
      );

      expect(refs).toEqual([
        { id: "m1", threadId: "t1" },
        { id: "m2", threadId: "t1" },
        { id: "m3", threadId: "t3" },
      ]);
      const api = apiCalls(calls);
      expect(api).toHaveLength(2);
      const first = new URL(api[0]!.url);
      expect(`${first.origin}${first.pathname}`).toBe(`${GMAIL_API_URL}/messages`);
      expect(first.searchParams.get("q")).toBe("from:no-reply@apap.com.do after:2026/10/06");
      expect(first.searchParams.get("maxResults")).toBe("500");
      expect(first.searchParams.has("pageToken")).toBe(false);
      expect(new URL(api[1]!.url).searchParams.get("pageToken")).toBe("p2");
      expect(api.every((c) => c.headers.Authorization === "Bearer ya29.test-1")).toBe(true);
      // One token for the whole listing.
      expect(calls.filter(isToken)).toHaveLength(1);
    });

    it("returns an empty list when nothing matches", async () => {
      const { gmail } = client((call) => (isToken(call) ? tokenReply() : { json: {} }));
      expect(await gmail.listMessages("from:x@example.com")).toEqual([]);
    });

    it("stops at maxMessages", async () => {
      const { gmail, calls } = client((call) => {
        if (isToken(call)) return tokenReply();
        return {
          json: {
            messages: [
              { id: "a", threadId: "a" },
              { id: "b", threadId: "b" },
              { id: "c", threadId: "c" },
            ],
            nextPageToken: "more",
          },
        };
      });
      const refs = await gmail.listMessages("label:inbox", null, { maxMessages: 2 });
      expect(refs.map((r) => r.id)).toEqual(["a", "b"]);
      const api = apiCalls(calls);
      expect(api).toHaveLength(1);
      expect(new URL(api[0]!.url).searchParams.get("maxResults")).toBe("2");
    });
  });

  describe("getMessage", () => {
    it("fetches format=full and returns a RawEmail the parsers read", async () => {
      const { gmail, calls } = client((call) =>
        isToken(call) ? tokenReply() : { json: apapHtmlOnly },
      );

      const raw = await gmail.getMessage(apapHtmlOnly.id);

      const api = apiCalls(calls);
      expect(api).toHaveLength(1);
      expect(api[0]!.url).toBe(`${GMAIL_API_URL}/messages/${apapHtmlOnly.id}?format=full`);
      expect(raw.from).toBe("APAP <NO-REPLY@apap.com.do>");
      expect(raw.date).toBe("2026-10-05T00:07:52.000Z");
      expect(raw.body).toContain("Monto: | 920.00");
      expect(parseEmail(raw)).toMatchObject({ bank: "APAP", amount: 920, cardLast4: "5977" });
    });

    it("loads a text body stored as an attachment", async () => {
      const { gmail, calls } = client((call) => {
        if (isToken(call)) return tokenReply();
        const path = new URL(call.url).pathname;
        if (path.endsWith(`/attachments/${encodeURIComponent(PAYPAL_ATTACHMENT_ID)}`)) {
          return { json: { size: PAYPAL_TEXT.length, data: b64url(PAYPAL_TEXT) } };
        }
        if (path.endsWith(`/messages/${paypalBodyAsAttachment.id}`)) {
          return { json: paypalBodyAsAttachment };
        }
        return undefined;
      });

      const raw = await gmail.getMessage(paypalBodyAsAttachment.id);

      expect(apiCalls(calls)).toHaveLength(2);
      expect(raw.body).toBe(PAYPAL_TEXT.replace(/\r\n/g, "\n"));
      expect(parseEmail(raw)).toMatchObject({
        bank: "PayPal",
        amount: 11.99,
        currency: "USD",
        cardLast4: "7782",
        merchant: "Spotify AB",
      });
    });

    it("encodes the message id in the URL", async () => {
      const { gmail, calls } = client((call) =>
        isToken(call) ? tokenReply() : { json: { ...apapHtmlOnly, id: "a/b?c" } },
      );
      await gmail.getMessage("a/b?c");
      expect(apiCalls(calls)[0]!.url).toBe(`${GMAIL_API_URL}/messages/a%2Fb%3Fc?format=full`);
    });
  });

  describe("access tokens", () => {
    it("reuses the token until a minute before it expires", async () => {
      let now = T0;
      const { gmail, calls } = client(
        (call) => (isToken(call) ? tokenReply(3600) : { json: {} }),
        () => now,
      );

      await gmail.listMessages("q");
      now = T0 + 58 * 60 * 1000;
      await gmail.listMessages("q");
      expect(calls.filter(isToken)).toHaveLength(1);

      now = T0 + 59 * 60 * 1000;
      await gmail.listMessages("q");
      expect(calls.filter(isToken)).toHaveLength(2);
      expect(apiCalls(calls).at(-1)!.headers.Authorization).toBe("Bearer ya29.test-2");
    });

    it("refreshes the token and retries once on a 401", async () => {
      const { gmail, calls } = client((call) => {
        if (isToken(call)) return tokenReply();
        return call.headers.Authorization === "Bearer ya29.test-1"
          ? { status: 401, json: { error: { message: "Invalid Credentials" } } }
          : { json: { messages: [{ id: "m1", threadId: "t1" }] } };
      });

      expect(await gmail.listMessages("q")).toEqual([{ id: "m1", threadId: "t1" }]);
      expect(calls.filter(isToken)).toHaveLength(2);
      expect(apiCalls(calls)).toHaveLength(2);
    });

    it("gives up after a second 401 and asks for a reconnect", async () => {
      const { gmail, calls } = client((call) =>
        isToken(call) ? tokenReply() : { status: 401, json: { error: { message: "Invalid" } } },
      );
      await expect(gmail.listMessages("q")).rejects.toMatchObject({
        status: 401,
        reconnectRequired: true,
      });
      expect(apiCalls(calls)).toHaveLength(2);
    });

    it("surfaces an invalid_grant from the refresh before calling Gmail", async () => {
      const { gmail, calls } = client(() => ({ status: 400, json: { error: "invalid_grant" } }));
      await expect(gmail.getMessage("m1")).rejects.toMatchObject({ reconnectRequired: true });
      expect(apiCalls(calls)).toHaveLength(0);
    });
  });

  describe("API errors", () => {
    it("asks for a reconnect when the Gmail scope is missing", async () => {
      const { gmail } = client((call) =>
        isToken(call)
          ? tokenReply()
          : {
              status: 403,
              json: {
                error: {
                  code: 403,
                  message: "Request had insufficient authentication scopes.",
                  status: "PERMISSION_DENIED",
                  errors: [{ reason: "insufficientPermissions" }],
                },
              },
            },
      );
      const error = await gmail.listMessages("q").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GmailError);
      expect(error).toMatchObject({
        status: 403,
        code: "insufficientPermissions",
        reconnectRequired: true,
      });
      expect((error as Error).message).toContain("insufficient authentication scopes");
    });

    it("keeps the connection on rate limits and server errors", async () => {
      const rateLimited = client((call) =>
        isToken(call)
          ? tokenReply()
          : {
              status: 403,
              json: {
                error: {
                  message: "User-rate limit exceeded.",
                  errors: [{ reason: "userRateLimitExceeded" }],
                },
              },
            },
      );
      await expect(rateLimited.gmail.listMessages("q")).rejects.toMatchObject({
        status: 403,
        code: "userRateLimitExceeded",
        reconnectRequired: false,
      });

      const down = client((call) => (isToken(call) ? tokenReply() : { status: 500 }));
      await expect(down.gmail.getMessage("m1")).rejects.toMatchObject({
        status: 500,
        code: null,
        reconnectRequired: false,
      });
    });

    it("reports a missing message as a 404", async () => {
      const { gmail } = client((call) => (isToken(call) ? tokenReply() : undefined));
      await expect(gmail.getMessage("gone")).rejects.toMatchObject({ status: 404 });
    });
  });
});
