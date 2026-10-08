import { describe, expect, it } from "vitest";
import { CryptoError } from "@/lib/crypto";
import type { RawEmail } from "@/lib/domain/types";
import { GmailError, type MessageRef } from "@/lib/gmail/client";
import { senderAddress } from "@/lib/parsers";
import * as apap from "@/lib/parsers/__fixtures__/apap";
import * as bsc from "@/lib/parsers/__fixtures__/bsc";
import * as paypal from "@/lib/parsers/__fixtures__/paypal";
import * as scotiabank from "@/lib/parsers/__fixtures__/scotiabank";
import type { SyncRunSummary } from "@/lib/repo/sync-runs";
import type { NewTransaction } from "@/lib/repo/transactions";
import {
  FETCH_CONCURRENCY,
  INITIAL_LOOKBACK_DAYS,
  MAX_RECORDED_ERRORS,
  SENDER_QUERIES,
  mapWithConcurrency,
  runSync,
  searchSince,
  type GmailReader,
  type SyncStore,
} from "./run";

const USER = "11111111-1111-4111-8111-111111111111";
const STARTED = "2026-10-07T16:00:00.000Z";
const FINISHED = "2026-10-07T16:00:05.000Z";
const LAST_SYNC = "2026-10-06T16:00:00.000Z";

const [cnp, use, abroad] = scotiabank.repeatedPurchase;

/** Every fixture the fake mailbox holds: purchases and non-purchases from the 4 senders. */
const MAILBOX: RawEmail[] = [
  cnp,
  use,
  abroad,
  scotiabank.paymentReceived,
  apap.contactless,
  apap.otpCode,
  bsc.consumption,
  paypal.spotify,
];

/** In-memory SyncStore that records what the sync did. */
function memoryStore(options: { lastSyncAt?: string | null; storedIds?: string[] } = {}) {
  const runs: Array<{ id: string; trigger: string; startedAt: string; summary?: SyncRunSummary }> =
    [];
  const inserted: NewTransaction[] = [];
  const storedIds = new Set(options.storedIds ?? []);
  const state = {
    lastSyncAt: "lastSyncAt" in options ? options.lastSyncAt : LAST_SYNC,
    rules: [] as { keyword: string; category: string }[],
    failInsert: null as Error | null,
    failStart: null as Error | null,
  };
  const store: SyncStore = {
    async startRun(userId, trigger, startedAt) {
      expect(userId).toBe(USER);
      if (state.failStart) throw state.failStart;
      runs.push({ id: `run-${runs.length + 1}`, trigger, startedAt });
      return runs.at(-1)!.id;
    },
    async finishRun(_userId, runId, summary) {
      runs.find((r) => r.id === runId)!.summary = summary;
    },
    async getLastSyncAt() {
      return state.lastSyncAt;
    },
    async setLastSyncAt(_userId, at) {
      state.lastSyncAt = at;
    },
    async listCategoryRules() {
      return state.rules;
    },
    async listStoredMessageIds(_userId, ids) {
      return new Set(ids.filter((id) => storedIds.has(id)));
    },
    async insertTransactions(_userId, items) {
      if (state.failInsert) throw state.failInsert;
      const fresh = items.filter((i) => !storedIds.has(i.gmailMessageId));
      for (const item of fresh) storedIds.add(item.gmailMessageId);
      inserted.push(...fresh);
      return { inserted: fresh.map(() => ({}) as never), skipped: items.length - fresh.length };
    },
  };
  return { store, state, runs, inserted, storedIds };
}

/** Fake Gmail over a list of emails: `from:<address>` queries match by sender. */
function fakeGmail(mailbox: RawEmail[] = MAILBOX) {
  const listCalls: Array<{ query: string; after: string | Date | null | undefined }> = [];
  const fetched: string[] = [];
  const failures = {
    list: new Map<string, Error>(),
    get: new Map<string, Error>(),
  };
  const gmail: GmailReader = {
    async listMessages(query, after) {
      listCalls.push({ query, after });
      const failure = failures.list.get(query);
      if (failure) throw failure;
      const address = /^from:(\S+)/.exec(query)![1];
      return mailbox
        .filter((m) => senderAddress(m.from) === address)
        .map((m): MessageRef => ({ id: m.id, threadId: m.threadId }));
    },
    async getMessage(id) {
      fetched.push(id);
      const failure = failures.get.get(id);
      if (failure) throw failure;
      const message = mailbox.find((m) => m.id === id);
      if (!message) throw new GmailError("Gmail API request failed (404)", 404);
      return message;
    },
  };
  return { gmail, listCalls, fetched, failures };
}

function clock() {
  const times = [STARTED, FINISHED];
  return () => new Date(times.shift() ?? FINISHED);
}

function deps(
  store: SyncStore,
  gmail: GmailReader | null,
  connect?: (userId: string) => Promise<GmailReader | null>,
) {
  return { store, connectGmail: connect ?? (async () => gmail), now: clock() };
}

describe("searchSince", () => {
  it("searches from a day before the last sync", () => {
    expect(searchSince(LAST_SYNC, STARTED)).toBe("2026-10-05T16:00:00.000Z");
  });

  it("looks back INITIAL_LOOKBACK_DAYS on the first sync", () => {
    const expected = new Date(Date.parse(STARTED) - INITIAL_LOOKBACK_DAYS * 86_400_000);
    expect(searchSince(null, STARTED)).toBe(expected.toISOString());
    expect(searchSince("garbage", STARTED)).toBe(expected.toISOString());
  });
});

describe("SENDER_QUERIES", () => {
  it("has one search per known sender; PayPal only receipts; Scotiabank refetches stored", () => {
    expect(SENDER_QUERIES).toEqual([
      {
        address: "alertas@scotiabank.com",
        query: "from:alertas@scotiabank.com",
        refetchStored: true,
      },
      { address: "no-reply@apap.com.do", query: "from:no-reply@apap.com.do", refetchStored: false },
      {
        address: "notificaciones@bsc.com.do",
        query: "from:notificaciones@bsc.com.do",
        refetchStored: false,
      },
      {
        address: "service@intl.paypal.com",
        query: "from:service@intl.paypal.com subject:receipt",
        refetchStored: false,
      },
    ]);
  });
});

describe("runSync", () => {
  it("stores each new purchase once, categorized, and records the run", async () => {
    const mem = memoryStore();
    const fake = fakeGmail();

    const result = await runSync(deps(mem.store, fake.gmail), USER, "manual");

    expect(fake.listCalls.map((c) => c.query)).toEqual(SENDER_QUERIES.map((q) => q.query));
    expect(fake.listCalls.every((c) => c.after === "2026-10-05T16:00:00.000Z")).toBe(true);
    expect(mem.inserted.map((t) => [t.gmailMessageId, t.bank, t.amount, t.category])).toEqual([
      ["sc-dup-use", "Scotiabank", 3420, "Compras online"],
      ["apap-contactless-1", "APAP", 920, "Restaurantes"],
      ["bsc-consumo-1", "Banco Santa Cruz", 394, "Supermercado"],
      ["paypal-spotify-1", "PayPal", 11.99, "Suscripciones"],
    ]);
    expect(result).toEqual({
      runId: "run-1",
      status: "ok",
      finishedAt: FINISHED,
      since: "2026-10-05T16:00:00.000Z",
      messagesSeen: 8,
      newTransactions: 4,
      unparsed: 2,
      duplicates: 2,
      alreadyStored: 0,
      errors: [],
      reconnectRequired: false,
    });
    expect(mem.runs).toEqual([
      {
        id: "run-1",
        trigger: "manual",
        startedAt: STARTED,
        summary: {
          status: "ok",
          finishedAt: FINISHED,
          messagesSeen: 8,
          newTransactions: 4,
          unparsed: 2,
          errors: [],
        },
      },
    ]);
    expect(mem.state.lastSyncAt).toBe(STARTED);
  });

  it("looks back INITIAL_LOOKBACK_DAYS on the first sync", async () => {
    const mem = memoryStore({ lastSyncAt: null });
    const fake = fakeGmail();
    const result = await runSync(deps(mem.store, fake.gmail), USER, "cron");
    expect(result.since).toBe(searchSince(null, STARTED));
    expect(mem.runs[0]!.trigger).toBe("cron");
    expect(mem.state.lastSyncAt).toBe(STARTED);
  });

  it("searches from options.since when importing history", async () => {
    const mem = memoryStore();
    const fake = fakeGmail();
    const since = "2026-04-01T04:00:00.000Z";
    const result = await runSync(deps(mem.store, fake.gmail), USER, "manual", { since });
    expect(result.since).toBe(since);
    expect(result.status).toBe("ok");
    expect(mem.state.lastSyncAt).toBe(STARTED);
  });

  it("applies the user's category rules before the defaults", async () => {
    const mem = memoryStore();
    mem.state.rules = [
      { keyword: "burger king", category: "Entretenimiento" },
      { keyword: "spotify", category: "Not a category" },
    ];
    await runSync(deps(mem.store, fakeGmail().gmail), USER, "manual");
    const categories = Object.fromEntries(mem.inserted.map((t) => [t.merchant, t.category]));
    expect(categories["BURGER KING SAN ISIDRO"]).toBe("Entretenimiento");
    expect(categories["Spotify AB"]).toBe("Suscripciones");
  });

  it("on a re-sync skips stored messages and never stores a later alert of a saved purchase", async () => {
    // An earlier run stored the card-not-present alert before the other two arrived.
    const mem = memoryStore({
      storedIds: ["sc-dup-cnp", "apap-contactless-1", "bsc-consumo-1", "paypal-spotify-1"],
    });
    const fake = fakeGmail();

    const result = await runSync(deps(mem.store, fake.gmail), USER, "cron");

    expect(mem.inserted).toEqual([]);
    // Stored messages of other banks are not fetched again; Scotiabank ones are (for dedupe).
    expect(fake.fetched.sort()).toEqual(
      ["apap-otp-1", "sc-dup-abroad", "sc-dup-cnp", "sc-dup-use", "sc-paid-1"].sort(),
    );
    expect(result).toMatchObject({
      status: "ok",
      messagesSeen: 8,
      newTransactions: 0,
      unparsed: 2,
      duplicates: 2,
      alreadyStored: 4,
    });
  });

  it("fetches a message listed by two searches once", async () => {
    const mem = memoryStore();
    const fake = fakeGmail();
    const twice: GmailReader = {
      listMessages: async (query, after) =>
        query.includes("apap")
          ? [
              ...(await fake.gmail.listMessages(query, after)),
              { id: "paypal-spotify-1", threadId: "t" },
            ]
          : fake.gmail.listMessages(query, after),
      getMessage: fake.gmail.getMessage,
    };
    const result = await runSync(deps(mem.store, twice), USER, "manual");
    expect(fake.fetched.filter((id) => id === "paypal-spotify-1")).toHaveLength(1);
    expect(result.messagesSeen).toBe(8);
    expect(result.newTransactions).toBe(4);
  });

  it("finishes cleanly when nothing is listed", async () => {
    const mem = memoryStore();
    const result = await runSync(deps(mem.store, fakeGmail([]).gmail), USER, "cron");
    expect(result).toMatchObject({ status: "ok", messagesSeen: 0, newTransactions: 0 });
    expect(mem.state.lastSyncAt).toBe(STARTED);
  });

  describe("failures", () => {
    it("ends with reconnectRequired when Gmail is not connected", async () => {
      for (const setup of [
        () => memoryStore({ lastSyncAt: undefined }),
        () => memoryStore(), // a row but no usable token
      ]) {
        const mem = setup();
        const fake = fakeGmail();
        const result = await runSync(deps(mem.store, null), USER, "manual");
        expect(result).toMatchObject({
          status: "error",
          reconnectRequired: true,
          since: null,
          errors: [{ gmailMessageId: null, message: "Gmail is not connected" }],
        });
        expect(fake.listCalls).toEqual([]);
        expect(mem.runs[0]!.summary?.status).toBe("error");
      }
    });

    it("asks for a reconnect when the stored token cannot be decrypted", async () => {
      const mem = memoryStore();
      const result = await runSync(
        deps(mem.store, null, async () => {
          throw new CryptoError("Decryption failed");
        }),
        USER,
        "manual",
      );
      expect(result).toMatchObject({ status: "error", reconnectRequired: true });
    });

    it("stops on a revoked token without storing anything or advancing last_sync_at", async () => {
      const mem = memoryStore();
      const fake = fakeGmail();
      fake.failures.list.set(
        SENDER_QUERIES[1]!.query,
        new GmailError(
          "Google token refresh failed (400 invalid_grant)",
          400,
          "invalid_grant",
          true,
        ),
      );

      const result = await runSync(deps(mem.store, fake.gmail), USER, "cron");

      expect(result).toMatchObject({
        status: "error",
        reconnectRequired: true,
        errors: [
          { gmailMessageId: null, message: "Google token refresh failed (400 invalid_grant)" },
        ],
      });
      expect(fake.listCalls).toHaveLength(2);
      expect(fake.fetched).toEqual([]);
      expect(mem.inserted).toEqual([]);
      expect(mem.state.lastSyncAt).toBe(LAST_SYNC);
    });

    it("records a failed message, stores the rest and keeps last_sync_at", async () => {
      const mem = memoryStore();
      const fake = fakeGmail();
      fake.failures.get.set("bsc-consumo-1", new GmailError("Gmail API request failed (500)", 500));

      const result = await runSync(deps(mem.store, fake.gmail), USER, "cron");

      expect(result).toMatchObject({
        status: "ok",
        newTransactions: 3,
        errors: [{ gmailMessageId: "bsc-consumo-1", message: "Gmail API request failed (500)" }],
      });
      expect(mem.inserted.map((t) => t.gmailMessageId)).not.toContain("bsc-consumo-1");
      expect(mem.state.lastSyncAt).toBe(LAST_SYNC);
    });

    it("records a failed search and goes on with the other senders", async () => {
      const mem = memoryStore();
      const fake = fakeGmail();
      fake.failures.list.set(
        SENDER_QUERIES[3]!.query,
        new GmailError("Gmail API request failed (503)", 503),
      );

      const result = await runSync(deps(mem.store, fake.gmail), USER, "cron");

      expect(result.status).toBe("ok");
      expect(result.newTransactions).toBe(3);
      expect(result.errors).toEqual([
        {
          gmailMessageId: null,
          message: "Listing service@intl.paypal.com failed: Gmail API request failed (503)",
        },
      ]);
      expect(mem.state.lastSyncAt).toBe(LAST_SYNC);
    });

    it("ends with status error when storing fails", async () => {
      const mem = memoryStore();
      mem.state.failInsert = new Error("upsertMany: connection reset");
      const result = await runSync(deps(mem.store, fakeGmail().gmail), USER, "cron");
      expect(result).toMatchObject({
        status: "error",
        reconnectRequired: false,
        newTransactions: 0,
        errors: [{ gmailMessageId: null, message: "upsertMany: connection reset" }],
      });
      expect(mem.runs[0]!.summary?.status).toBe("error");
      expect(mem.state.lastSyncAt).toBe(LAST_SYNC);
    });

    it("throws when the run cannot be recorded", async () => {
      const mem = memoryStore();
      mem.state.failStart = new Error("startSyncRun: permission denied");
      await expect(runSync(deps(mem.store, fakeGmail().gmail), USER, "cron")).rejects.toThrow(
        "permission denied",
      );
    });

    it("keeps at most MAX_RECORDED_ERRORS errors and summarizes the rest", async () => {
      const many: RawEmail[] = Array.from({ length: MAX_RECORDED_ERRORS + 7 }, (_, i) => ({
        ...apap.contactless,
        id: `apap-${i}`,
      }));
      const fake = fakeGmail(many);
      for (const m of many) fake.failures.get.set(m.id, new Error(`boom ${m.id}`));
      const result = await runSync(deps(memoryStore().store, fake.gmail), USER, "cron");
      expect(result.errors).toHaveLength(MAX_RECORDED_ERRORS + 1);
      expect(result.errors.at(-1)).toEqual({
        gmailMessageId: null,
        message: "7 more errors not recorded",
      });
    });
  });
});

describe("mapWithConcurrency", () => {
  it("keeps the input order and never exceeds the limit", async () => {
    let running = 0;
    let peak = 0;
    const result = await mapWithConcurrency([5, 1, 4, 2, 3, 0, 6], FETCH_CONCURRENCY, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, n));
      running -= 1;
      return n * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30, 0, 60]);
    expect(peak).toBeLessThanOrEqual(FETCH_CONCURRENCY);
  });

  it("starts nothing new after a failure and rethrows it", async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
        started.push(n);
        if (n === 2) throw new Error("stop");
        await new Promise((resolve) => setTimeout(resolve, 5));
        return n;
      }),
    ).rejects.toThrow("stop");
    expect(started).toEqual([1, 2]);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([]);
  });
});
