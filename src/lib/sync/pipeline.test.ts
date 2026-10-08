// @vitest-environment node
/**
 * End-to-end tests of the Gmail sync without a network. Everything below the HTTP layer is the
 * real code: the Gmail client (token refresh, paging, attachments) talking to a fake Gmail API
 * through an injected fetch, MIME decoding, the four parsers, Scotiabank deduplication,
 * categorization with the user's rules, the encrypted refresh token, and the real migrations
 * in PGlite behind a SQL SyncStore. Runs follow each other in time over one mailbox, so the
 * tests also cover what happens between syncs.
 */

import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";
import type { RawEmail, Transaction } from "@/lib/domain/types";
import {
  GMAIL_API_URL,
  GOOGLE_TOKEN_URL,
  createGmailClient,
  type HttpFetch,
} from "@/lib/gmail/client";
import {
  PAYPAL_ATTACHMENT_ID,
  PAYPAL_TEXT,
  apapHtmlOnly,
  b64url,
  bscBlankPlainWithAttachment,
  paypalBodyAsAttachment,
  scotiabankAlternative,
} from "@/lib/gmail/__fixtures__/messages";
import type { GmailMessage } from "@/lib/gmail/mime";
import { senderAddress } from "@/lib/parsers";
import * as apap from "@/lib/parsers/__fixtures__/apap";
import * as bsc from "@/lib/parsers/__fixtures__/bsc";
import * as paypal from "@/lib/parsers/__fixtures__/paypal";
import * as scotiabank from "@/lib/parsers/__fixtures__/scotiabank";
import { toTransaction, type TransactionRow } from "@/lib/repo/transactions";
import { createMigratedDb, createUser } from "@/test/pglite";
import { runCronSync } from "./requests";
import { runSync, type SyncDeps, type SyncResult, type SyncStore } from "./run";

// Test-only values; never real credentials.
const KEY = Buffer.alloc(32, 7);
const CREDENTIALS = { clientId: "test-client.apps.googleusercontent.com", clientSecret: "shh" };
/** Messages per page of the fake `messages.list`, small so paging is exercised. */
const LIST_PAGE = 3;

// ---------------------------------------------------------------------------
// Mailbox: Gmail API messages, visible once their receive time has passed
// ---------------------------------------------------------------------------

/** A parser fixture as Gmail returns it (`format=full`, one text/plain part). */
function gmailMessage(raw: RawEmail): GmailMessage {
  return {
    id: raw.id,
    threadId: raw.threadId,
    internalDate: String(Date.parse(raw.date)),
    snippet: raw.snippet,
    payload: {
      mimeType: "text/plain",
      filename: "",
      headers: [
        { name: "From", value: raw.from },
        { name: "Subject", value: raw.subject },
        { name: "Content-Type", value: 'text/plain; charset="UTF-8"' },
      ],
      body: { size: raw.body.length, data: b64url(raw.body) },
    },
  };
}

function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
}

const [dupCnp, dupUse, dupAbroad] = scotiabank.repeatedPurchase;

/** A Scotiabank alert from March: older than the first sync's six-month lookback. */
const oldAlert: RawEmail = {
  ...scotiabank.creditCardUse,
  id: "sc-old-1",
  date: "2026-03-01T23:35:41.000Z",
};

/** Satoru's mailbox: purchases, repeats and non-purchases from the four senders. */
const SATORU_MAILBOX: GmailMessage[] = [
  scotiabankAlternative, // SUPERM. NACIONAL MAXIM, 5,986.90 DOP, multipart/alternative
  apapHtmlOnly, // BURGER KING, 920.00 DOP, HTML only in ISO-8859-1
  bscBlankPlainWithAttachment, // SM BRAVO, 394.00 DOP, blank text/plain + HTML + files (arrives 7 Oct)
  paypalBodyAsAttachment, // Spotify AB, 11.99 USD, body as an attachment
  ...[
    oldAlert,
    dupCnp,
    dupUse,
    dupAbroad,
    scotiabank.repeatedPurchaseLater,
    scotiabank.aroundMidnight,
    scotiabank.cardVerification,
    scotiabank.paymentReceived,
    apap.onlineUsd,
    apap.otpCode,
    bsc.usdWithThousands,
    bsc.transferReceived,
    paypal.moneyReceived,
    paypal.promotion,
  ].map(gmailMessage),
];

// ---------------------------------------------------------------------------
// Fake Google: OAuth token endpoint + Gmail API, one mailbox per refresh token
// ---------------------------------------------------------------------------

interface ListCall {
  q: string;
  pageToken: string | null;
}

function fakeGoogle(clock: { now: Date }) {
  const accounts = new Map<string, GmailMessage[]>();
  const accessTokens = new Map<string, string>();
  const revoked = new Set<string>();
  /** Message ids answered with a 500 (even after retries) until removed. */
  const failing = new Set<string>();
  const listCalls: ListCall[] = [];
  const fetched: string[] = [];
  let issued = 0;

  const reply = (status: number, json: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(json),
  });

  const fetch: HttpFetch = async (url, init) => {
    if (url === GOOGLE_TOKEN_URL) {
      const form = new URLSearchParams(init.body);
      const refreshToken = form.get("refresh_token") ?? "";
      expect(form.get("grant_type")).toBe("refresh_token");
      expect(form.get("client_id")).toBe(CREDENTIALS.clientId);
      if (!accounts.has(refreshToken) || revoked.has(refreshToken)) {
        return reply(400, { error: "invalid_grant", error_description: "Token has been revoked." });
      }
      issued += 1;
      const token = `ya29.test-${issued}`;
      accessTokens.set(token, refreshToken);
      return reply(200, { access_token: token, expires_in: 3599, token_type: "Bearer" });
    }

    expect(init.method).toBe("GET");
    const bearer = /^Bearer (.+)$/.exec(init.headers.Authorization ?? "")?.[1] ?? "";
    const account = accessTokens.get(bearer);
    if (!account) return reply(401, { error: { code: 401, message: "Invalid Credentials" } });
    // Only what has arrived by now is in the mailbox.
    const mailbox = accounts
      .get(account)!
      .filter((m) => Number(m.internalDate) <= clock.now.getTime());

    const { pathname, searchParams } = new URL(url);
    const path = pathname.slice(new URL(GMAIL_API_URL).pathname.length);

    if (path === "/messages") {
      const q = searchParams.get("q") ?? "";
      const pageToken = searchParams.get("pageToken");
      listCalls.push({ q, pageToken });
      const matches = search(mailbox, q).sort(
        (a, b) => Number(b.internalDate) - Number(a.internalDate),
      );
      const offset = Number(pageToken ?? 0);
      const page = matches.slice(offset, offset + LIST_PAGE);
      return reply(200, {
        ...(page.length > 0
          ? { messages: page.map((m) => ({ id: m.id, threadId: m.threadId })) }
          : {}),
        ...(offset + LIST_PAGE < matches.length
          ? { nextPageToken: String(offset + LIST_PAGE) }
          : {}),
        resultSizeEstimate: matches.length,
      });
    }

    const attachment = /^\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
    if (attachment) {
      expect(decodeURIComponent(attachment[2]!)).toBe(PAYPAL_ATTACHMENT_ID);
      return reply(200, { size: PAYPAL_TEXT.length, data: b64url(PAYPAL_TEXT) });
    }

    const get = /^\/messages\/([^/]+)$/.exec(path);
    if (get) {
      const id = decodeURIComponent(get[1]!);
      expect(searchParams.get("format")).toBe("full");
      fetched.push(id);
      if (failing.has(id)) {
        return reply(500, { error: { code: 500, message: "Backend Error", status: "INTERNAL" } });
      }
      const message = mailbox.find((m) => m.id === id);
      if (!message)
        return reply(404, { error: { code: 404, message: "Requested entity was not found." } });
      // The client fills attachment bodies in place; never hand out the fixture itself.
      return reply(200, structuredClone(message));
    }

    return reply(404, { error: { code: 404, message: "Not Found" } });
  };

  return { fetch, accounts, revoked, failing, listCalls, fetched };
}

/**
 * Gmail search for the operators the sync uses: `from:` (case-insensitive address),
 * `subject:` (word) and `after:YYYY/MM/DD` (from midnight, Dominican Republic time).
 */
function search(mailbox: GmailMessage[], q: string): GmailMessage[] {
  const from = /\bfrom:(\S+)/.exec(q)?.[1]?.toLowerCase();
  const subject = /\bsubject:(\S+)/.exec(q)?.[1]?.toLowerCase();
  const after = /\bafter:(\d{4})\/(\d{2})\/(\d{2})/.exec(q);
  const since = after ? Date.parse(`${after[1]}-${after[2]}-${after[3]}T00:00:00-04:00`) : 0;
  return mailbox.filter(
    (m) =>
      (!from || senderAddress(header(m, "from")) === from) &&
      (!subject || header(m, "subject").toLowerCase().includes(subject)) &&
      Number(m.internalDate) >= since,
  );
}

// ---------------------------------------------------------------------------
// SQL SyncStore over the real schema (PGlite runs as a superuser, like service_role)
// ---------------------------------------------------------------------------

function sqlStore(db: PGlite): SyncStore {
  return {
    async startRun(userId, trigger, startedAt) {
      const { rows } = await db.query<{ id: string }>(
        "insert into public.sync_runs (user_id, trigger, status, started_at) values ($1, $2, 'running', $3) returning id",
        [userId, trigger, startedAt],
      );
      return rows[0]!.id;
    },
    async finishRun(userId, runId, s) {
      await db.query(
        `update public.sync_runs set status = $3, finished_at = $4, messages_seen = $5,
           new_transactions = $6, unparsed = $7, errors = $8::jsonb
         where id = $2 and user_id = $1`,
        [
          userId,
          runId,
          s.status,
          s.finishedAt,
          s.messagesSeen,
          s.newTransactions,
          s.unparsed,
          JSON.stringify(s.errors),
        ],
      );
    },
    async getLastSyncAt(userId) {
      const { rows } = await db.query<{ last_sync_at: Date | null }>(
        "select last_sync_at from public.gmail_connections where user_id = $1",
        [userId],
      );
      if (rows.length === 0) return undefined;
      return rows[0]!.last_sync_at?.toISOString() ?? null;
    },
    async setLastSyncAt(userId, at) {
      await db.query("update public.gmail_connections set last_sync_at = $2 where user_id = $1", [
        userId,
        at,
      ]);
    },
    async listCategoryRules(userId) {
      const { rows } = await db.query<{ keyword: string; category: string }>(
        "select keyword, category from public.category_rules where user_id = $1 order by created_at",
        [userId],
      );
      return rows;
    },
    async listStoredMessageIds(userId, ids) {
      const { rows } = await db.query<{ gmail_message_id: string }>(
        "select gmail_message_id from public.transactions where user_id = $1 and gmail_message_id = any($2::text[])",
        [userId, [...ids]],
      );
      return new Set(rows.map((r) => r.gmail_message_id));
    },
    async insertTransactions(userId, items) {
      const inserted: Transaction[] = [];
      for (const t of items) {
        const { rows } = await db.query<DbRow>(
          `insert into public.transactions (user_id, gmail_message_id, date, month, bank, card_last4,
             amount, currency, merchant, kind, category, source)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'gmail')
           on conflict (user_id, gmail_message_id) do nothing
           returning ${COLUMNS}`,
          [
            userId,
            t.gmailMessageId,
            t.date,
            t.month,
            t.bank,
            t.cardLast4,
            t.amount,
            t.currency,
            t.merchant,
            t.kind,
            t.category,
          ],
        );
        inserted.push(...rows.map(fromDb));
      }
      return { inserted, skipped: items.length - inserted.length };
    },
  };
}

const COLUMNS =
  "id, user_id, gmail_message_id, date, month, bank, card_last4, amount, currency, merchant, kind, category, ignored, source";

type DbRow = Omit<TransactionRow, "date"> & { date: Date };

/** A row as PGlite returns it, through the repository's own row mapping. */
function fromDb(row: DbRow): Transaction {
  return toTransaction({ ...row, date: row.date.toISOString() });
}

async function transactions(db: PGlite, userId: string): Promise<Transaction[]> {
  const { rows } = await db.query<DbRow>(
    `select ${COLUMNS} from public.transactions where user_id = $1 order by date, gmail_message_id`,
    [userId],
  );
  return rows.map(fromDb);
}

/** One line per stored purchase: what the dashboard will show. */
async function ledger(db: PGlite, userId: string) {
  return (await transactions(db, userId)).map((t) =>
    [
      t.gmailMessageId,
      t.date,
      t.bank,
      t.cardLast4,
      t.amount,
      t.currency,
      t.merchant,
      t.category,
    ].join(" · "),
  );
}

async function syncRuns(db: PGlite, userId: string) {
  const { rows } = await db.query<{
    trigger: string;
    status: string;
    messages_seen: number;
    new_transactions: number;
    unparsed: number;
    errors: unknown;
  }>(
    `select trigger, status, messages_seen, new_transactions, unparsed, errors
     from public.sync_runs where user_id = $1 order by started_at`,
    [userId],
  );
  return rows;
}

async function lastSyncAt(db: PGlite, userId: string): Promise<string | null> {
  const value = await sqlStore(db).getLastSyncAt(userId);
  return value ?? null;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Connects a user's Gmail the way the auth callback does (token encrypted for the user). */
async function connect(db: PGlite, userId: string, email: string, refreshToken: string) {
  await db.query(
    "insert into public.gmail_connections (user_id, email, refresh_token_encrypted, scope) values ($1, $2, $3, $4)",
    [
      userId,
      email,
      encrypt(refreshToken, KEY, userId),
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
  );
}

let db: PGlite;
let clock: { now: Date };
let google: ReturnType<typeof fakeGoogle>;
let satoru: string;

/** Real deps except the database driver and fetch: decrypts the stored token, real client. */
function syncDeps(): SyncDeps {
  return {
    store: sqlStore(db),
    async connectGmail(userId) {
      const { rows } = await db.query<{ refresh_token_encrypted: string }>(
        "select refresh_token_encrypted from public.gmail_connections where user_id = $1",
        [userId],
      );
      if (rows.length === 0) return null;
      const refreshToken = decrypt(rows[0]!.refresh_token_encrypted, KEY, userId);
      return createGmailClient({
        credentials: CREDENTIALS,
        refreshToken,
        fetch: google.fetch,
        now: () => clock.now.getTime(),
        sleep: async () => {},
      });
    },
    now: () => clock.now,
  };
}

async function syncAt(iso: string, userId = satoru): Promise<SyncResult> {
  clock.now = new Date(iso);
  return runSync(syncDeps(), userId, "cron");
}

beforeEach(async () => {
  db = await createMigratedDb();
  clock = { now: new Date(0) };
  google = fakeGoogle(clock);
  satoru = await createUser(db, "satoru@example.com");
  await connect(db, satoru, "satoru@example.com", "1//0satoru-refresh-token");
  google.accounts.set("1//0satoru-refresh-token", SATORU_MAILBOX);
});

afterEach(async () => {
  await db.close();
});

// Run 1: just after the card-not-present alert of the Amazon purchase arrived; the other two
// alerts of that purchase arrive in the next minutes. Run 2: the next morning.
const RUN_1 = "2026-10-06T22:14:50.000Z";
const RUN_2 = "2026-10-07T12:00:00.000Z";

const FIRST_SYNC_LEDGER = [
  "18f2c00000000b01 · 2026-10-04T10:22:31-04:00 · PayPal · 7782 · 11.99 · USD · Spotify AB · Suscripciones",
  "18f2a0c3d4e5f601 · 2026-10-04T19:35:00-04:00 · Scotiabank · 7341 · 5986.9 · DOP · SUPERM. NACIONAL MAXIM · Supermercado",
  "18f2a1b2c3d4e5f6 · 2026-10-04T20:07:00-04:00 · APAP · 5977 · 920 · DOP · BURGER KING SAN ISIDRO · Restaurantes",
  "bsc-usd-1 · 2026-10-05T11:01:59-04:00 · Banco Santa Cruz · 9236 · 1045.5 · USD · AIRBNB * HMZ3K2P SAN FRANCISCOUS · Viajes",
  "apap-online-1 · 2026-10-06T09:05:00-04:00 · APAP · 5977 · 1250 · USD · AMAZON MKTPL*ZK4LP0 · Compras online",
  "sc-dup-cnp · 2026-10-06T18:14:00-04:00 · Scotiabank · 7341 · 3420 · DOP · AMAZON MKTPLACE PMTS · Compras online",
];

describe("Gmail sync, end to end", () => {
  it("first sync: reads six months from every sender and stores each purchase once", async () => {
    const result = await syncAt(RUN_1);

    expect(result).toMatchObject({
      status: "ok",
      since: "2026-04-06T22:14:50.000Z",
      newTransactions: 6,
      duplicates: 0,
      alreadyStored: 0,
      errors: [],
      reconnectRequired: false,
    });
    // Searches carry the DR date; PayPal only receipts; the March alert is out of range.
    expect(new Set(google.listCalls.map((c) => c.q))).toEqual(
      new Set([
        "from:alertas@scotiabank.com after:2026/04/06",
        "from:no-reply@apap.com.do after:2026/04/06",
        "from:notificaciones@bsc.com.do after:2026/04/06",
        "from:service@intl.paypal.com subject:receipt after:2026/04/06",
      ]),
    );
    expect(google.listCalls.some((c) => c.pageToken !== null)).toBe(true);
    expect(google.fetched).not.toContain("sc-old-1");
    expect(google.fetched).not.toContain("paypal-received-1");
    expect(google.fetched).not.toContain("paypal-promo-1");

    expect(await ledger(db, satoru)).toEqual(FIRST_SYNC_LEDGER);
    // Non-purchases from known senders: $0.10 card check, payment, OTP, transfer.
    expect(result.unparsed).toBe(4);
    expect(result.messagesSeen).toBe(10);
    expect(await syncRuns(db, satoru)).toEqual([
      {
        trigger: "cron",
        status: "ok",
        messages_seen: 10,
        new_transactions: 6,
        unparsed: 4,
        errors: [],
      },
    ]);
    expect(await lastSyncAt(db, satoru)).toBe(RUN_1);
  });

  it("next sync: stores only new purchases, skips repeats and keeps the user's edits", async () => {
    await syncAt(RUN_1);

    // Between the runs the user recategorizes and hides purchases and adds a rule.
    await db.query(
      "update public.transactions set category = 'Hogar' where user_id = $1 and gmail_message_id = 'apap-online-1'",
      [satoru],
    );
    await db.query(
      "update public.transactions set ignored = true where user_id = $1 and gmail_message_id = $2",
      [satoru, paypalBodyAsAttachment.id],
    );
    await db.query(
      "insert into public.category_rules (user_id, keyword, category) values ($1, 'hot dog', 'Entretenimiento')",
      [satoru],
    );
    google.listCalls.length = 0;
    google.fetched.length = 0;

    const result = await syncAt(RUN_2);

    expect(result).toMatchObject({
      status: "ok",
      since: "2026-10-05T22:14:50.000Z",
      newTransactions: 3,
      // The "Uso" and "fuera del país" alerts of the Amazon purchase stored in run 1.
      duplicates: 2,
      unparsed: 0,
      errors: [],
    });
    expect(google.listCalls.every((c) => c.q.endsWith("after:2026/10/05"))).toBe(true);
    // Stored messages are not fetched again, except Scotiabank ones (needed to spot repeats).
    expect(google.fetched).not.toContain("apap-online-1");
    expect(google.fetched).not.toContain("bsc-usd-1");
    expect(google.fetched).toContain("sc-dup-cnp");

    const after = await transactions(db, satoru);
    expect(after).toHaveLength(9);
    const byId = new Map(after.map((t) => [t.gmailMessageId, t]));
    // A second real purchase with the same card, amount and merchant 20 minutes later.
    expect(byId.get("sc-dup-later")).toMatchObject({
      date: "2026-10-06T18:35:00-04:00",
      amount: 3420,
      category: "Compras online",
    });
    expect(byId.has("sc-dup-use")).toBe(false);
    expect(byId.has("sc-dup-abroad")).toBe(false);
    // Bought at 11:58 pm on the 6th, received after midnight; the user's rule wins.
    expect(byId.get("sc-midnight-1")).toMatchObject({
      date: "2026-10-06T23:58:00-04:00",
      month: "2026-10",
      merchant: "HOT DOG EL TIGRE",
      category: "Entretenimiento",
    });
    expect(byId.get(bscBlankPlainWithAttachment.id)).toMatchObject({
      bank: "Banco Santa Cruz",
      amount: 394,
      currency: "DOP",
      merchant: "SM BRAVO LAS AMERICAS SANTO DOMINGODO",
      category: "Supermercado",
    });
    // Edits survive the re-sync.
    expect(byId.get("apap-online-1")).toMatchObject({ category: "Hogar", ignored: false });
    expect(byId.get(paypalBodyAsAttachment.id)).toMatchObject({
      category: "Suscripciones",
      ignored: true,
    });
    expect(await lastSyncAt(db, satoru)).toBe(RUN_2);
  });

  it("a revoked grant stops the run, asks for a new sign-in and changes nothing", async () => {
    await syncAt(RUN_1);
    const before = await transactions(db, satoru);
    google.revoked.add("1//0satoru-refresh-token");

    const result = await syncAt(RUN_2);

    expect(result).toMatchObject({
      status: "error",
      reconnectRequired: true,
      newTransactions: 0,
      errors: [
        { gmailMessageId: null, message: "Google token refresh failed (400 invalid_grant)" },
      ],
    });
    expect(await transactions(db, satoru)).toEqual(before);
    expect((await syncRuns(db, satoru)).map((r) => [r.status, r.errors])).toEqual([
      ["ok", []],
      [
        "error",
        [{ gmailMessageId: null, message: "Google token refresh failed (400 invalid_grant)" }],
      ],
    ]);
    expect(await lastSyncAt(db, satoru)).toBe(RUN_1);

    // After signing in again, the next run catches up on everything since run 1.
    google.revoked.clear();
    const retry = await syncAt("2026-10-07T13:00:00.000Z");
    expect(retry).toMatchObject({ status: "ok", newTransactions: 3, duplicates: 2 });
  });

  it("a message that fails to load is recorded and picked up by the next run", async () => {
    google.failing.add("bsc-usd-1");

    const first = await syncAt(RUN_1);

    expect(first).toMatchObject({
      status: "ok",
      newTransactions: 5,
      errors: [
        { gmailMessageId: "bsc-usd-1", message: "Gmail API request failed (500): Backend Error" },
      ],
    });
    expect((await syncRuns(db, satoru))[0]!.errors).toEqual([
      { gmailMessageId: "bsc-usd-1", message: "Gmail API request failed (500): Backend Error" },
    ]);
    // last_sync_at stays put so the failed message is searched again.
    expect(await lastSyncAt(db, satoru)).toBeNull();

    google.failing.delete("bsc-usd-1");
    const second = await syncAt(RUN_1.replace("22:14:50", "22:14:55"));
    expect(second).toMatchObject({ status: "ok", newTransactions: 1, errors: [] });
    expect((await transactions(db, satoru)).map((t) => t.gmailMessageId)).toContain("bsc-usd-1");
    expect(await lastSyncAt(db, satoru)).toBe("2026-10-06T22:14:55.000Z");
  });

  it("re-running with nothing new stores nothing", async () => {
    await syncAt(RUN_2);
    const before = await transactions(db, satoru);

    const again = await syncAt("2026-10-07T12:15:00.000Z");

    expect(again).toMatchObject({ status: "ok", newTransactions: 0, duplicates: 2, unparsed: 0 });
    expect(await transactions(db, satoru)).toEqual(before);
  });

  it("the cron syncs every connected user into their own rows", async () => {
    const ana = await createUser(db, "ana@example.com");
    await connect(db, ana, "ana@example.com", "1//0ana-refresh-token");
    google.accounts.set("1//0ana-refresh-token", [gmailMessage(bsc.consumption)]);
    // Connected once, but Google no longer accepts the token.
    const luis = await createUser(db, "luis@example.com");
    await connect(db, luis, "luis@example.com", "1//0luis-refresh-token");
    clock.now = new Date(RUN_2);

    const { rows } = await db.query<{ user_id: string }>(
      "select user_id from public.gmail_connections order by user_id",
    );
    const summary = await runCronSync({
      listConnectedUserIds: async () => rows.map((r) => r.user_id),
      isSyncRunning: async () => false,
      runSync: (userId) => runSync(syncDeps(), userId, "cron"),
      now: () => clock.now,
    });

    expect(summary).toEqual({
      users: 3,
      ok: 2,
      failed: 1,
      skipped: 0,
      reconnectRequired: 1,
      newTransactions: 9 + 1,
    });
    expect(await ledger(db, ana)).toEqual([
      "bsc-consumo-1 · 2026-10-06T23:18:05-04:00 · Banco Santa Cruz · 9236 · 394 · DOP · SM BRAVO LAS AMERICAS SANTO DOMINGODO · Supermercado",
    ]);
    expect(await transactions(db, luis)).toEqual([]);
    expect((await transactions(db, satoru)).map((t) => t.gmailMessageId)).not.toContain(
      "bsc-consumo-1",
    );
    expect((await syncRuns(db, luis)).map((r) => r.status)).toEqual(["error"]);
  });
});
