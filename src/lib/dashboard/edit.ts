/**
 * The user's edits from the transactions table: change the category, ignore or restore.
 * The server actions in src/app/app/actions.ts only wire these to Supabase, so the rules
 * (who may edit, what input is accepted, what the browser sees) are tested without a network.
 *
 * Their arguments come from the browser, so they are checked here before reaching the database.
 */

import { isCategory } from "@/lib/domain/categorize";
import type { Category, Transaction } from "@/lib/domain/types";

export type EditError = "unauthenticated" | "invalid_input" | "not_found" | "failed";

export type EditResult = { ok: true } | { ok: false; error: EditError };

export interface EditDeps {
  /** The signed-in user's id, or null. */
  getUserId(): Promise<string | null>;
  updateCategory(userId: string, id: string, category: Category): Promise<Transaction | null>;
  setIgnored(userId: string, id: string, ignored: boolean): Promise<Transaction | null>;
  log(message: string): void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isTransactionId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

async function run(
  deps: EditDeps,
  operation: string,
  update: (userId: string) => Promise<Transaction | null>,
): Promise<EditResult> {
  const userId = await deps.getUserId();
  if (!userId) return { ok: false, error: "unauthenticated" };
  try {
    const transaction = await update(userId);
    return transaction ? { ok: true } : { ok: false, error: "not_found" };
  } catch (error) {
    deps.log(`${operation} failed: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, error: "failed" };
  }
}

/** Sets the category of one of the signed-in user's transactions. */
export async function changeCategory(
  deps: EditDeps,
  id: unknown,
  category: unknown,
): Promise<EditResult> {
  if (!isTransactionId(id) || typeof category !== "string" || !isCategory(category)) {
    return { ok: false, error: "invalid_input" };
  }
  return run(deps, "changeCategory", (userId) => deps.updateCategory(userId, id, category));
}

/** Leaves one of the signed-in user's transactions out of the totals, or brings it back. */
export async function changeIgnored(
  deps: EditDeps,
  id: unknown,
  ignored: unknown,
): Promise<EditResult> {
  if (!isTransactionId(id) || typeof ignored !== "boolean") {
    return { ok: false, error: "invalid_input" };
  }
  return run(deps, "changeIgnored", (userId) => deps.setIgnored(userId, id, ignored));
}

const MESSAGES: Record<EditError, string> = {
  unauthenticated: "Your session expired. Sign in again to save changes.",
  invalid_input: "That change is not valid. Reload the page and try again.",
  not_found: "That purchase no longer exists. Reload the page.",
  failed: "Could not save the change. Please try again.",
};

/** What the table says when an edit is not saved. */
export function editErrorMessage(error: EditError): string {
  return MESSAGES[error];
}
