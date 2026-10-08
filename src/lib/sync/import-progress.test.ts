import { describe, expect, it } from "vitest";
import type { ImportMonth } from "@/lib/repo/import-months";
import {
  ESTIMATED_MS_PER_MONTH,
  estimateImportMs,
  formatDuration,
  summarizeImport,
} from "./import-progress";

const NOW = new Date("2026-10-08T14:00:00.000Z");

function month(overrides: Partial<ImportMonth>): ImportMonth {
  return {
    id: overrides.month ?? "m",
    month: "2026-10",
    status: "pending",
    attempts: 0,
    nextAttemptAt: NOW.toISOString(),
    messagesSeen: 0,
    newTransactions: 0,
    lastError: null,
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("summarizeImport", () => {
  it("is empty and inactive without months", () => {
    expect(summarizeImport([], NOW)).toMatchObject({
      total: 0,
      percent: 0,
      active: false,
      nextAttemptAt: null,
      oldestMonth: null,
    });
  });

  it("counts each state and finds the next retry", () => {
    const progress = summarizeImport(
      [
        month({ month: "2026-07", status: "failed", attempts: 5 }),
        month({ month: "2026-10", status: "done", newTransactions: 7 }),
        month({ month: "2026-09", status: "running", newTransactions: 2 }),
        month({ month: "2026-08", status: "error", nextAttemptAt: "2026-10-08T14:05:00.000Z" }),
      ],
      NOW,
    );
    expect(progress).toEqual({
      total: 4,
      done: 1,
      failed: 1,
      waiting: 1,
      running: "2026-09",
      percent: 50,
      newTransactions: 9,
      nextAttemptAt: "2026-10-08T14:05:00.000Z",
      active: true,
      oldestMonth: "2026-07",
      months: [
        { month: "2026-10", status: "done" },
        { month: "2026-09", status: "running" },
        { month: "2026-08", status: "error" },
        { month: "2026-07", status: "failed" },
      ],
    });
  });

  it("never reports a retry time in the past", () => {
    const progress = summarizeImport([month({ nextAttemptAt: "2026-10-08T13:00:00.000Z" })], NOW);
    expect(progress.nextAttemptAt).toBe(NOW.toISOString());
  });
});

describe("estimates", () => {
  it("scale with the months", () => {
    expect(estimateImportMs(10)).toBe(10 * ESTIMATED_MS_PER_MONTH);
    expect(estimateImportMs(-1)).toBe(0);
  });

  it("read naturally", () => {
    expect(formatDuration(20_000)).toBe("less than a minute");
    expect(formatDuration(60_000)).toBe("about 1 minute");
    expect(formatDuration(9 * 60_000)).toBe("about 9 minutes");
    expect(formatDuration(60 * 60_000)).toBe("about 1 hour");
    expect(formatDuration(91 * 60_000)).toBe("about 1 hour 31 minutes");
  });
});
