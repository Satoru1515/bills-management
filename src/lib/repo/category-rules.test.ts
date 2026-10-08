import { describe, expect, it } from "vitest";
import { argsOf, createSupabaseMock, methodsOf } from "@/test/supabase-mock";
import { listCategoryRules } from "./category-rules";

const USER = "11111111-1111-4111-8111-111111111111";

describe("listCategoryRules", () => {
  it("returns the user's rules oldest first", async () => {
    const mock = createSupabaseMock();
    mock.respond({
      data: [
        { keyword: "bravo", category: "Supermercado" },
        { keyword: "gym", category: "Salud" },
      ],
    });

    await expect(listCategoryRules(mock.client, USER)).resolves.toEqual([
      { keyword: "bravo", category: "Supermercado" },
      { keyword: "gym", category: "Salud" },
    ]);
    expect(mock.queries[0]!.table).toBe("category_rules");
    expect(methodsOf(mock.queries[0])).toEqual(["select", "eq", "order"]);
    expect(argsOf(mock.queries[0], "select")).toEqual([["keyword, category"]]);
    expect(argsOf(mock.queries[0], "eq")).toEqual([["user_id", USER]]);
    expect(argsOf(mock.queries[0], "order")).toEqual([["created_at", { ascending: true }]]);
  });

  it("returns an empty list when there are none", async () => {
    const mock = createSupabaseMock();
    mock.respond({ data: null });
    await expect(listCategoryRules(mock.client, USER)).resolves.toEqual([]);
  });

  it("wraps database errors in RepoError", async () => {
    const mock = createSupabaseMock();
    mock.respond({ error: { message: "boom" } });
    await expect(listCategoryRules(mock.client, USER)).rejects.toThrow("listCategoryRules: boom");
  });
});
