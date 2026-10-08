import { describe, expect, it } from "vitest";
import { dashboardHref, resolveCategory } from "./url";

describe("dashboardHref", () => {
  it("puts the month in the query", () => {
    expect(dashboardHref("2026-09")).toBe("/app?month=2026-09");
    expect(dashboardHref("2026-09", { category: null })).toBe("/app?month=2026-09");
  });

  it("adds the category, encoded", () => {
    expect(dashboardHref("2026-09", { category: "Compras online" })).toBe(
      "/app?month=2026-09&category=Compras+online",
    );
    expect(dashboardHref("2026-09", { category: "Cuidado personal" })).toBe(
      "/app?month=2026-09&category=Cuidado+personal",
    );
  });
});

describe("resolveCategory", () => {
  it("accepts known categories only", () => {
    expect(resolveCategory("Supermercado")).toBe("Supermercado");
    expect(resolveCategory("Compras online")).toBe("Compras online");
    expect(resolveCategory(["Salud", "Otros"])).toBe("Salud");
    expect(resolveCategory("supermercado")).toBeNull();
    expect(resolveCategory("Nope")).toBeNull();
    expect(resolveCategory("")).toBeNull();
    expect(resolveCategory(undefined)).toBeNull();
    expect(resolveCategory([])).toBeNull();
  });
});
