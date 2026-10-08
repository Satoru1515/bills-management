import { describe, expect, it } from "vitest";
import { argsOf, createSupabaseMock, methodsOf } from "@/test/supabase-mock";
import { getUsdToDopRate } from "./profiles";

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
