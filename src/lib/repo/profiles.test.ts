import { describe, expect, it } from "vitest";
import { argsOf, createSupabaseMock, methodsOf } from "@/test/supabase-mock";
import { getUsdToDopRate, setUsdToDopRate } from "./profiles";

const USER = "11111111-1111-4111-8111-111111111111";

describe("getUsdToDopRate", () => {
  it("reads the rate from the user's profile", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: { usd_to_dop_rate: 62.85 } });

    await expect(getUsdToDopRate(mock.client, USER)).resolves.toBe(62.85);
    expect(mock.queries[0]!.table).toBe("profiles");
    expect(methodsOf(mock.queries[0])).toEqual(["select", "eq", "maybeSingle"]);
    expect(argsOf(mock.queries[0], "select")).toEqual([["usd_to_dop_rate"]]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([["id", USER]]);
  });

  it("accepts numeric values sent as strings", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: { usd_to_dop_rate: "63.1000" } });
    await expect(getUsdToDopRate(mock.client, USER)).resolves.toBe(63.1);
  });

  it("is null when the rate is not set or there is no profile", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: { usd_to_dop_rate: null } }, { data: null });
    await expect(getUsdToDopRate(mock.client, USER)).resolves.toBeNull();
    await expect(getUsdToDopRate(mock.client, USER)).resolves.toBeNull();
  });

  it("ignores values that are not a positive number", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: { usd_to_dop_rate: "abc" } }, { data: { usd_to_dop_rate: 0 } });
    await expect(getUsdToDopRate(mock.client, USER)).resolves.toBeNull();
    await expect(getUsdToDopRate(mock.client, USER)).resolves.toBeNull();
  });

  it("wraps database errors in RepoError", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "boom", code: "42501" } });
    await expect(getUsdToDopRate(mock.client, USER)).rejects.toMatchObject({
      name: "RepoError",
      message: "getUsdToDopRate: boom",
      code: "42501",
    });
  });
});

describe("setUsdToDopRate", () => {
  it("updates the user's own profile", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: { id: USER } });

    await expect(setUsdToDopRate(mock.client, USER, 62.85)).resolves.toBe(true);
    expect(mock.queries[0]!.table).toBe("profiles");
    expect(methodsOf(mock.queries[0])).toEqual(["update", "eq", "select", "maybeSingle"]);
    expect(argsOf(mock.queries[0], "update")).toEqual([[{ usd_to_dop_rate: 62.85 }]]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([["id", USER]]);
  });

  it("clears the rate with null and reports a missing profile", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null });
    await expect(setUsdToDopRate(mock.client, USER, null)).resolves.toBe(false);
    expect(argsOf(mock.queries[0], "update")).toEqual([[{ usd_to_dop_rate: null }]]);
  });

  it("rejects rates that are not positive numbers without querying", async () => {
    const mock = createSupabaseMock();
    await expect(setUsdToDopRate(mock.client, USER, 0)).rejects.toThrow("invalid rate");
    await expect(setUsdToDopRate(mock.client, USER, Number.NaN)).rejects.toThrow("invalid rate");
    expect(mock.queries).toHaveLength(0);
  });

  it("wraps database errors in RepoError", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "violates check constraint", code: "23514" } });
    await expect(setUsdToDopRate(mock.client, USER, 63)).rejects.toMatchObject({
      name: "RepoError",
      message: "setUsdToDopRate: violates check constraint",
      code: "23514",
    });
  });
});
