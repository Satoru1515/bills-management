/** Dashboard URLs and their query parameters. Safe to import from browser code. */

import { isCategory } from "@/lib/domain/categorize";
import type { Category } from "@/lib/domain/types";

export const DASHBOARD_PATH = "/app";
export const SETTINGS_PATH = "/app/settings";

export interface DashboardFilters {
  /** Show only this category in the breakdowns; null or missing = every category. */
  category?: Category | null;
}

/** The dashboard for a `YYYY-MM` month, with optional filters. */
export function dashboardHref(month: string, filters: DashboardFilters = {}): string {
  const params = new URLSearchParams({ month });
  if (filters.category) params.set("category", filters.category);
  return `${DASHBOARD_PATH}?${params.toString()}`;
}

/** The category of a `?category=` query value, or null when missing or unknown. */
export function resolveCategory(value: string | string[] | undefined): Category | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate !== undefined && isCategory(candidate) ? candidate : null;
}
