/**
 * Gmail sync for one user: search the known senders since the last sync (minus a day of
 * overlap), parse, deduplicate the repeated Scotiabank alerts, categorize, store the new
 * purchases and record the run in `sync_runs`. Server-only.
 *
 * `runSync` takes its database and Gmail access as dependencies so the pipeline can be tested
 * without a network; `createSyncDeps` wires the real ones (service-role client, stored refresh
 * token, Google OAuth credentials).
 */

import { CryptoError, encryptionKey } from "@/lib/crypto";
import { createCategorizer, withUserRules, type StoredCategoryRule } from "@/lib/domain/categorize";
import { dedupeScotiabank, type ParsedMessage } from "@/lib/domain/dedupe";
import {
  GmailError,
  createGmailClient,
  googleOAuthCredentials,
  type GmailClient,
  type MessageRef,
} from "@/lib/gmail/client";
import { PARSERS_BY_SENDER, parseEmail } from "@/lib/parsers";
import { listCategoryRules } from "@/lib/repo/category-rules";
import { getLastSyncAt, getRefreshToken, setLastSyncAt } from "@/lib/repo/gmail-connections";
import {
  finishSyncRun,
  startSyncRun,
  type SyncRunError,
  type SyncRunSummary,
  type SyncTrigger,
} from "@/lib/repo/sync-runs";
import {
  listStoredMessageIds,
  upsertMany,
  type DbClient,
  type NewTransaction,
  type UpsertResult,
} from "@/lib/repo/transactions";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back the first sync of a user searches (about six months). */
export const INITIAL_LOOKBACK_DAYS = 183;
/** Later syncs search from this long before the last one started (docs/parsing-spec.md §6). */
export const SEARCH_OVERLAP_MS = DAY_MS;
/** Gmail messages fetched in parallel (kept low: Gmail limits requests per user per minute). */
export const FETCH_CONCURRENCY = 3;
/** Errors kept in `sync_runs.errors`; the rest are summarized in one entry. */
export const MAX_RECORDED_ERRORS = 50;
const MAX_ERROR_LENGTH = 500;

const PAYPAL_SENDER = "service@intl.paypal.com";
const SCOTIABANK_SENDER = "alertas@scotiabank.com";

export interface SenderQuery {
  address: string;
  /** Gmail search, without the `after:` date. */
  query: string;
  /**
   * Fetch messages already stored too. Scotiabank needs them so a later alert for a purchase
   * that is already saved is recognized as a repeat (see `dedupeScotiabank`).
   */
  refetchStored: boolean;
}

/** One search per known sender (docs/parsing-spec.md §6); PayPal only sends receipts. */
export const SENDER_QUERIES: readonly SenderQuery[] = [...PARSERS_BY_SENDER.keys()].map(
  (address) => ({
    address,
    query: `from:${address}${address === PAYPAL_SENDER ? " subject:receipt" : ""}`,
    refetchStored: address === SCOTIABANK_SENDER,
  }),
);

/** Start of the Gmail search: a day before the last sync, or the initial lookback. */
export function searchSince(lastSyncAt: string | null, startedAt: string): string {
  const last = lastSyncAt === null ? Number.NaN : Date.parse(lastSyncAt);
  const since = Number.isNaN(last)
    ? Date.parse(startedAt) - INITIAL_LOOKBACK_DAYS * DAY_MS
    : last - SEARCH_OVERLAP_MS;
  return new Date(since).toISOString();
}

export type GmailReader = Pick<GmailClient, "listMessages" | "getMessage">;

/** Database operations the sync needs, all scoped to one user. */
export interface SyncStore {
  startRun(userId: string, trigger: SyncTrigger, startedAt: string): Promise<string>;
  finishRun(userId: string, runId: string, summary: SyncRunSummary): Promise<void>;
  /** Null if never synced; undefined if Gmail is not connected. */
  getLastSyncAt(userId: string): Promise<string | null | undefined>;
  setLastSyncAt(userId: string, at: string): Promise<void>;
  listCategoryRules(userId: string): Promise<StoredCategoryRule[]>;
  listStoredMessageIds(userId: string, gmailMessageIds: readonly string[]): Promise<Set<string>>;
  insertTransactions(userId: string, items: readonly NewTransaction[]): Promise<UpsertResult>;
}

/** {@link SyncStore} over the repositories, for the service-role client. */
export function createSyncStore(admin: DbClient): SyncStore {
  return {
    startRun: (userId, trigger, startedAt) => startSyncRun(admin, userId, trigger, startedAt),
    finishRun: (userId, runId, summary) => finishSyncRun(admin, userId, runId, summary),
    getLastSyncAt: (userId) => getLastSyncAt(admin, userId),
    setLastSyncAt: (userId, at) => setLastSyncAt(admin, userId, at),
    listCategoryRules: (userId) => listCategoryRules(admin, userId),
    listStoredMessageIds: (userId, ids) => listStoredMessageIds(admin, userId, ids),
    insertTransactions: (userId, items) => upsertMany(admin, userId, items),
  };
}

export interface SyncDeps {
  store: SyncStore;
  /** Gmail access for the user, or null when there is no stored token. */
  connectGmail(userId: string): Promise<GmailReader | null>;
  now?: () => Date;
}

/** Real dependencies: repositories on the service-role client and the stored Gmail token. */
export function createSyncDeps(admin: DbClient): SyncDeps {
  const key = encryptionKey();
  const credentials = googleOAuthCredentials();
  return {
    store: createSyncStore(admin),
    async connectGmail(userId) {
      const refreshToken = await getRefreshToken(admin, userId, key);
      return refreshToken ? createGmailClient({ credentials, refreshToken }) : null;
    },
  };
}

export interface SyncOptions {
  /**
   * Search Gmail from this ISO instant instead of from the last sync, to import older emails
   * ("Import history"). Purchases already stored are skipped as usual.
   */
  since?: string;
}

export interface SyncResult extends SyncRunSummary {
  runId: string;
  /** Start of the Gmail search window, or null if the run stopped before searching. */
  since: string | null;
  /** Repeated Scotiabank alerts that were not stored. */
  duplicates: number;
  /** Listed messages that were already stored by an earlier sync. */
  alreadyStored: number;
  /** The user must sign in with Google again (no token, revoked, expired or missing scope). */
  reconnectRequired: boolean;
}

/** Thrown inside a run when Gmail is not connected for the user. */
class NotConnectedError extends Error {
  constructor() {
    super("Gmail is not connected");
    this.name = "NotConnectedError";
  }
}

interface RunState {
  since: string | null;
  messagesSeen: number;
  newTransactions: number;
  unparsed: number;
  duplicates: number;
  alreadyStored: number;
  errors: SyncRunError[];
  droppedErrors: number;
}

/**
 * Syncs one user's Gmail. Expected failures (Gmail not connected, revoked token, Gmail or
 * database errors) end the run with status `error` and are returned, not thrown; only a failure
 * to create or complete the `sync_runs` row throws. Errors on single messages are recorded and
 * the rest of the run continues. `last_sync_at` only moves forward after a run without errors,
 * so anything missed is searched again next time.
 */
export async function runSync(
  deps: SyncDeps,
  userId: string,
  trigger: SyncTrigger,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date());
  const { store } = deps;
  const startedAt = now().toISOString();
  const runId = await store.startRun(userId, trigger, startedAt);

  const state: RunState = {
    since: null,
    messagesSeen: 0,
    newTransactions: 0,
    unparsed: 0,
    duplicates: 0,
    alreadyStored: 0,
    errors: [],
    droppedErrors: 0,
  };
  let failed = false;
  let reconnectRequired = false;

  try {
    await syncMessages(deps, userId, startedAt, state, options);
  } catch (error) {
    failed = true;
    reconnectRequired =
      error instanceof NotConnectedError ||
      error instanceof CryptoError ||
      (error instanceof GmailError && error.reconnectRequired);
    recordError(state, null, error);
  }

  const errors = [...state.errors];
  if (state.droppedErrors > 0) {
    errors.push({
      gmailMessageId: null,
      message: `${state.droppedErrors} more errors not recorded`,
    });
  }
  const summary: SyncRunSummary = {
    status: failed ? "error" : "ok",
    finishedAt: now().toISOString(),
    messagesSeen: state.messagesSeen,
    newTransactions: state.newTransactions,
    unparsed: state.unparsed,
    errors,
  };
  await store.finishRun(userId, runId, summary);

  return {
    ...summary,
    runId,
    since: state.since,
    duplicates: state.duplicates,
    alreadyStored: state.alreadyStored,
    reconnectRequired,
  };
}

interface Listed {
  id: string;
  refetchStored: boolean;
}

async function syncMessages(
  deps: SyncDeps,
  userId: string,
  startedAt: string,
  state: RunState,
  options: SyncOptions,
): Promise<void> {
  const { store } = deps;
  const lastSyncAt = await store.getLastSyncAt(userId);
  if (lastSyncAt === undefined) throw new NotConnectedError();
  const gmail = await deps.connectGmail(userId);
  if (!gmail) throw new NotConnectedError();

  const categorize = createCategorizer(withUserRules(await store.listCategoryRules(userId)));
  const since = options.since ?? searchSince(lastSyncAt, startedAt);
  state.since = since;

  // 1. List every message from the known senders since the last sync.
  const listed = new Map<string, Listed>();
  for (const sender of SENDER_QUERIES) {
    let refs: MessageRef[];
    try {
      refs = await gmail.listMessages(sender.query, since);
    } catch (error) {
      if (isFatal(error)) throw error;
      recordError(state, null, error, `Listing ${sender.address} failed: `);
      continue;
    }
    for (const { id } of refs) {
      const previous = listed.get(id);
      listed.set(id, { id, refetchStored: sender.refetchStored || !!previous?.refetchStored });
    }
  }
  state.messagesSeen = listed.size;
  if (listed.size === 0) {
    await finishWithoutErrors(store, userId, startedAt, state);
    return;
  }

  // 2. Skip what is already stored, except where deduplication needs it.
  const stored = await store.listStoredMessageIds(userId, [...listed.keys()]);
  state.alreadyStored = stored.size;
  const toFetch = [...listed.values()].filter((m) => !stored.has(m.id) || m.refetchStored);

  // 3. Fetch and parse.
  const emails = await mapWithConcurrency(toFetch, FETCH_CONCURRENCY, async ({ id }) => {
    try {
      return await gmail.getMessage(id);
    } catch (error) {
      if (isFatal(error)) throw error;
      recordError(state, id, error);
      return null;
    }
  });
  const parsed: ParsedMessage[] = [];
  for (const raw of emails) {
    if (!raw) continue;
    const purchase = parseEmail(raw);
    if (purchase) parsed.push({ raw, parsed: purchase });
    else if (!stored.has(raw.id)) state.unparsed += 1;
  }

  // 4. Collapse repeated Scotiabank alerts, keeping any one stored earlier.
  const isStored = (m: ParsedMessage) => stored.has(m.raw.id);
  const { kept, dropped } = dedupeScotiabank(parsed, { isStored });
  state.duplicates = dropped.filter((m) => !isStored(m)).length;

  // 5. Categorize and store the new purchases (never overwriting existing rows).
  const items: NewTransaction[] = kept
    .filter((m) => !isStored(m))
    .map(({ parsed: p }) => ({ ...p, category: categorize(p.merchant) }));
  if (items.length > 0) {
    const { inserted } = await store.insertTransactions(userId, items);
    state.newTransactions = inserted.length;
  }

  await finishWithoutErrors(store, userId, startedAt, state);
}

/** Moves `last_sync_at` to this run's start, unless something failed along the way. */
async function finishWithoutErrors(
  store: SyncStore,
  userId: string,
  startedAt: string,
  state: RunState,
): Promise<void> {
  if (state.errors.length === 0 && state.droppedErrors === 0) {
    await store.setLastSyncAt(userId, startedAt);
  }
}

/** Errors that stop the whole run: the Gmail grant no longer works. */
function isFatal(error: unknown): boolean {
  return error instanceof GmailError && error.reconnectRequired;
}

function recordError(
  state: RunState,
  gmailMessageId: string | null,
  error: unknown,
  prefix = "",
): void {
  if (state.errors.length >= MAX_RECORDED_ERRORS) {
    state.droppedErrors += 1;
    return;
  }
  const text = error instanceof Error ? error.message : String(error);
  state.errors.push({ gmailMessageId, message: `${prefix}${text}`.slice(0, MAX_ERROR_LENGTH) });
}

/**
 * Maps `items` with at most `limit` calls in flight, keeping the input order. If a call
 * throws, no new calls start and the first error is rethrown once the running ones settle.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;

  async function worker(): Promise<void> {
    while (!failure && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]!);
      } catch (error) {
        failure ??= { error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw (failure as { error: unknown }).error;
  return results;
}
