import { describe, expect, it } from "vitest";
import {
  MANUAL_SYNC_COOLDOWN_MS,
  MANUAL_SYNC_LIMIT_PER_WINDOW,
  MANUAL_SYNC_WINDOW_MS,
  manualSyncRetryAfter,
  manualSyncWindowStart,
} from "./rate-limit";

const NOW = new Date("2026-10-07T16:00:00.000Z");

/** ISO time `minutes` (may be fractional) before NOW. */
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe("rate limit settings", () => {
  it("allows one manual sync a minute and ten an hour", () => {
    expect(MANUAL_SYNC_COOLDOWN_MS).toBe(60_000);
    expect(MANUAL_SYNC_WINDOW_MS).toBe(3_600_000);
    expect(MANUAL_SYNC_LIMIT_PER_WINDOW).toBe(10);
  });
});

describe("manualSyncWindowStart", () => {
  it("is one hour before now", () => {
    expect(manualSyncWindowStart(NOW)).toBe("2026-10-07T15:00:00.000Z");
  });
});

describe("manualSyncRetryAfter", () => {
  it("lets the first sync through", () => {
    expect(manualSyncRetryAfter([], NOW)).toBeNull();
  });

  it("asks to wait out the cooldown after a recent sync", () => {
    expect(manualSyncRetryAfter([NOW.toISOString()], NOW)).toBe(60);
    expect(manualSyncRetryAfter([ago(0.25)], NOW)).toBe(45);
    // Rounds up so the client never retries a moment too early.
    expect(manualSyncRetryAfter([new Date(NOW.getTime() - 59_500).toISOString()], NOW)).toBe(1);
  });

  it("lets a sync through once the cooldown is over", () => {
    expect(manualSyncRetryAfter([ago(1)], NOW)).toBeNull();
    expect(manualSyncRetryAfter([ago(5), ago(30)], NOW)).toBeNull();
  });

  it("uses the latest sync for the cooldown whatever the order", () => {
    expect(manualSyncRetryAfter([ago(30), ago(0.5), ago(10)], NOW)).toBe(30);
  });

  it("allows up to the hourly limit", () => {
    const nine = Array.from({ length: 9 }, (_, i) => ago(5 + i * 6));
    expect(manualSyncRetryAfter(nine, NOW)).toBeNull();
  });

  it("blocks the eleventh sync in an hour until the oldest counted one leaves the window", () => {
    // Ten syncs, 2 to 56 minutes ago: the one 56 minutes ago leaves the window in 4 minutes.
    const ten = Array.from({ length: 10 }, (_, i) => ago(2 + i * 6));
    expect(manualSyncRetryAfter(ten, NOW)).toBe(4 * 60);
  });

  it("counts only the latest syncs when more than the limit are given", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ago(2 + i * 4));
    // The tenth newest started 38 minutes ago.
    expect(manualSyncRetryAfter(twelve, NOW)).toBe(22 * 60);
  });

  it("ignores syncs outside the window and unreadable times", () => {
    const old = Array.from({ length: 10 }, (_, i) => ago(61 + i));
    expect(manualSyncRetryAfter([...old, "not a date", ""], NOW)).toBeNull();
  });

  it("never asks to wait longer than the window, even for a start time in the future", () => {
    expect(manualSyncRetryAfter([ago(-600)], NOW)).toBe(3600);
  });
});
