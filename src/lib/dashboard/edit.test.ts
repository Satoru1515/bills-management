import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@/lib/domain/types";
import { changeCategory, changeIgnored, editErrorMessage, type EditDeps } from "./edit";

const USER = "11111111-1111-4111-8111-111111111111";
const TX_ID = "22222222-2222-4222-8222-222222222222";

const STORED = { id: TX_ID } as Transaction;

function deps(overrides: Partial<EditDeps> = {}) {
  return {
    getUserId: vi.fn(async (): Promise<string | null> => USER),
    updateCategory: vi.fn(async (): Promise<Transaction | null> => STORED),
    setIgnored: vi.fn(async (): Promise<Transaction | null> => STORED),
    log: vi.fn(),
    ...overrides,
  };
}

describe("changeCategory", () => {
  it("updates the signed-in user's transaction", async () => {
    const d = deps();
    await expect(changeCategory(d, TX_ID, "Restaurantes")).resolves.toEqual({ ok: true });
    expect(d.updateCategory).toHaveBeenCalledWith(USER, TX_ID, "Restaurantes");
  });

  it("rejects unknown categories and malformed ids without touching the database", async () => {
    const d = deps();
    const invalid = { ok: false, error: "invalid_input" };
    await expect(changeCategory(d, TX_ID, "Nope")).resolves.toEqual(invalid);
    await expect(changeCategory(d, TX_ID, 3)).resolves.toEqual(invalid);
    await expect(changeCategory(d, "tx-1", "Otros")).resolves.toEqual(invalid);
    await expect(changeCategory(d, undefined, "Otros")).resolves.toEqual(invalid);
    expect(d.getUserId).not.toHaveBeenCalled();
    expect(d.updateCategory).not.toHaveBeenCalled();
  });

  it("needs a signed-in user", async () => {
    const d = deps({ getUserId: vi.fn(async () => null) });
    await expect(changeCategory(d, TX_ID, "Otros")).resolves.toEqual({
      ok: false,
      error: "unauthenticated",
    });
    expect(d.updateCategory).not.toHaveBeenCalled();
  });

  it("reports a transaction that is not the user's (or no longer exists)", async () => {
    const d = deps({ updateCategory: vi.fn(async () => null) });
    await expect(changeCategory(d, TX_ID, "Otros")).resolves.toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("logs a database failure and hides its details", async () => {
    const d = deps({
      updateCategory: vi.fn(async () => {
        throw new Error("updateCategory: connection reset");
      }),
    });
    await expect(changeCategory(d, TX_ID, "Otros")).resolves.toEqual({
      ok: false,
      error: "failed",
    });
    expect(d.log).toHaveBeenCalledWith("changeCategory failed: updateCategory: connection reset");
  });
});

describe("changeIgnored", () => {
  it("ignores and restores", async () => {
    const d = deps();
    await expect(changeIgnored(d, TX_ID, true)).resolves.toEqual({ ok: true });
    await expect(changeIgnored(d, TX_ID.toUpperCase(), false)).resolves.toEqual({ ok: true });
    expect(vi.mocked(d.setIgnored).mock.calls).toEqual([
      [USER, TX_ID, true],
      [USER, TX_ID.toUpperCase(), false],
    ]);
  });

  it("only accepts a boolean", async () => {
    const d = deps();
    await expect(changeIgnored(d, TX_ID, "true")).resolves.toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(d.setIgnored).not.toHaveBeenCalled();
  });

  it("reports missing transactions and failures", async () => {
    await expect(
      changeIgnored(deps({ setIgnored: vi.fn(async () => null) }), TX_ID, true),
    ).resolves.toEqual({ ok: false, error: "not_found" });

    const log = vi.fn();
    const failing = deps({ setIgnored: vi.fn(() => Promise.reject("boom")), log });
    await expect(changeIgnored(failing, TX_ID, true)).resolves.toEqual({
      ok: false,
      error: "failed",
    });
    expect(log).toHaveBeenCalledWith("changeIgnored failed: boom");
  });
});

describe("editErrorMessage", () => {
  it("has a message for every error", () => {
    expect(editErrorMessage("unauthenticated")).toMatch(/Sign in again/);
    expect(editErrorMessage("invalid_input")).toMatch(/Reload/);
    expect(editErrorMessage("not_found")).toMatch(/no longer exists/);
    expect(editErrorMessage("failed")).toBe("Could not save the change. Please try again.");
  });
});
