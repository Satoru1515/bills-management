/** Dashboard URLs. Safe to import from browser code. */

export const DASHBOARD_PATH = "/app";

/** The dashboard for a `YYYY-MM` month. */
export function dashboardHref(month: string): string {
  return `${DASHBOARD_PATH}?month=${encodeURIComponent(month)}`;
}
