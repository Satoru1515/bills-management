import { describe, expect, it, vi } from "vitest";
import { parseRate, saveRate, type SaveRateDeps } from "./rate";

const USER = "11111111-1111-4111-8111-111111111111";

describe("parseRate", () => {
  it("accepts a dot or a comma as the decimal separator", () => {
    expect(parseRate("63")).toEqual({ ok: true, rate: 63 });
    expect(parseRate(" 62.85 ")).toEqual({ ok: true, rate: 62.85 });
    expect(parseRate("62,85")).toEqual({ ok: true, rate: 62.85 });
    expect(parseRate("62.1234")).toEqual({ ok: true, rate: 62.1234 });
  });

  it("treats an empty box as the app default", () => {
    expect(parseRate("")).toEqual({ ok: true, rate: null });
    expect(parseRate("   ")).toEqual({ ok: true, rate: null });
    expect(parseRate(null)).toEqual({ ok: true, rate: null });
  });

  it("rejects text, signs, thousands separators and too many decimals", () => {
    for (const value of ["abc", "-63", "+63", "1,234.5", "63.12345", "63.", ".5", "6 3", "RD$63"]) {
      expect(parseRate(value)).toEqual({
        ok: false,
        message: "Enter the rate as a number, for example 62.85.",
      });
    }
  });

  it("rejects rates outside 1 to 1000", () => {
    const outOfRange = { ok: false, message: "Enter a rate between 1 and 1000 pesos per dollar." };
    expect(parseRate("0")).toEqual(outOfRange);
    expect(parseRate("0.5")).toEqual(outOfRange);
    expect(parseRate("1000.01")).toEqual(outOfRange);
    expect(parseRate("6300")).toEqual(outOfRange);
    expect(parseRate("1")).toEqual({ ok: true, rate: 1 });
    expect(parseRate("1000")).toEqual({ ok: true, rate: 1000 });
  });
});

function deps(overrides: Partial<SaveRateDeps> = {}): SaveRateDeps {
  return {
    getUserId: vi.fn(async (): Promise<string | null> => USER),
    setRate: vi.fn(async () => true),
    log: vi.fn(),
    ...overrides,
  };
}

describe("saveRate", () => {
  it("saves a valid rate for the signed-in user", async () => {
    const d = deps();
    await expect(saveRate(d, "62,5")).resolves.toEqual({
      status: "saved",
      message: "Saved. Dollar purchases now count at 62.50 pesos.",
    });
    expect(d.setRate).toHaveBeenCalledWith(USER, 62.5);
  });

  it("goes back to the default with an empty box", async () => {
    const d = deps();
    await expect(saveRate(d, "")).resolves.toEqual({
      status: "saved",
      message: "Saved. Using the default rate of 63.00.",
    });
    expect(d.setRate).toHaveBeenCalledWith(USER, null);
  });

  it("does not touch the database for invalid input", async () => {
    const d = deps();
    await expect(saveRate(d, "abc")).resolves.toMatchObject({ status: "error" });
    expect(d.getUserId).not.toHaveBeenCalled();
    expect(d.setRate).not.toHaveBeenCalled();
  });

  it("needs a signed-in user with a profile", async () => {
    await expect(saveRate(deps({ getUserId: vi.fn(async () => null) }), "63")).resolves.toEqual({
      status: "error",
      message: "Your session expired. Sign in again to save changes.",
    });
    await expect(saveRate(deps({ setRate: vi.fn(async () => false) }), "63")).resolves.toEqual({
      status: "error",
      message: "Your profile was not found. Sign out and in again.",
    });
  });

  it("logs a database failure and shows a generic message", async () => {
    const log = vi.fn();
    const failing = deps({
      setRate: vi.fn(async () => {
        throw new Error("setUsdToDopRate: connection reset");
      }),
      log,
    });
    await expect(saveRate(failing, "63")).resolves.toEqual({
      status: "error",
      message: "Could not save the rate. Please try again.",
    });
    expect(log).toHaveBeenCalledWith("saveRate failed: setUsdToDopRate: connection reset");
  });
});
