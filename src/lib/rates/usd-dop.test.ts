import { describe, expect, it, vi } from "vitest";
import { fetchUsdToDopRate, lookupRate, parseRateBody, rateUrls, type HttpFetch } from "./usd-dop";

// Thursday 8 October 2026, 10 AM in the Dominican Republic.
const NOW = new Date("2026-10-08T14:00:00Z");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SEPT_15 = { date: "2026-09-15", usd: { dop: 58.95822092, eur: 0.85 } };

describe("rateUrls", () => {
  it("lists jsDelivr first and the Cloudflare mirror second", () => {
    expect(rateUrls("2026-09-15")).toEqual([
      "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2026-09-15/v1/currencies/usd.json",
      "https://2026-09-15.currency-api.pages.dev/v1/currencies/usd.json",
    ]);
  });
});

describe("parseRateBody", () => {
  it("reads the peso rate, rounded to 4 decimals", () => {
    expect(parseRateBody(SEPT_15)).toEqual({ date: "2026-09-15", rate: 58.9582 });
  });

  it("refuses missing, malformed or implausible rates", () => {
    expect(parseRateBody(null)).toBeNull();
    expect(parseRateBody({ date: "2026-09-15" })).toBeNull();
    expect(parseRateBody({ date: "2026-09-15", usd: { eur: 0.85 } })).toBeNull();
    expect(parseRateBody({ date: "2026-09-15", usd: { dop: "58.9" } })).toBeNull();
    expect(parseRateBody({ date: "2026-09-15", usd: { dop: 0.5 } })).toBeNull();
    expect(parseRateBody({ date: "2026-09-15", usd: { dop: 5000 } })).toBeNull();
  });
});

describe("fetchUsdToDopRate", () => {
  it("uses the first mirror that answers", async () => {
    const doFetch = vi.fn<HttpFetch>(async () => json(SEPT_15));
    await expect(fetchUsdToDopRate("2026-09-15", doFetch)).resolves.toEqual({
      date: "2026-09-15",
      rate: 58.9582,
    });
    expect(doFetch).toHaveBeenCalledOnce();
  });

  it("falls back to the mirror when the first fails or answers badly", async () => {
    const doFetch = vi
      .fn<HttpFetch>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(json(SEPT_15));
    await expect(fetchUsdToDopRate("2026-09-15", doFetch)).resolves.toMatchObject({
      rate: 58.9582,
    });
    expect(doFetch.mock.calls.map(([url]) => url)).toEqual(rateUrls("2026-09-15"));
  });

  it("is null when no mirror has the rate", async () => {
    const doFetch = vi.fn<HttpFetch>(async () => json({ message: "Not found" }, 404));
    await expect(fetchUsdToDopRate("2026-09-15", doFetch)).resolves.toBeNull();
    expect(doFetch).toHaveBeenCalledTimes(2);
  });
});

describe("lookupRate", () => {
  it("returns the day's rate with a message", async () => {
    const doFetch = vi.fn<HttpFetch>(async () => json(SEPT_15));
    await expect(lookupRate("2026-09-15", NOW, doFetch)).resolves.toEqual({
      ok: true,
      date: "2026-09-15",
      rate: 58.9582,
      message: "Rate on Sep 15, 2026: 58.9582. Press Save to use it.",
    });
  });

  it("uses the latest rate when today's is not published yet", async () => {
    const doFetch = vi.fn<HttpFetch>(async (url) =>
      url.includes("latest")
        ? json({ date: "2026-10-07", usd: { dop: 60.25610556 } })
        : json({}, 404),
    );
    await expect(lookupRate("2026-10-08", NOW, doFetch)).resolves.toMatchObject({
      ok: true,
      date: "2026-10-07",
      rate: 60.2561,
      message: "Rate on Oct 7, 2026: 60.2561. Press Save to use it.",
    });
    expect(doFetch).toHaveBeenCalledTimes(3);
  });

  it("does not try the latest rate for a past day", async () => {
    const doFetch = vi.fn<HttpFetch>(async () => json({}, 404));
    await expect(lookupRate("2026-09-15", NOW, doFetch)).resolves.toEqual({
      ok: false,
      message: "Could not get the rate for that day. Try again later or type it in.",
    });
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  it("checks the day before fetching", async () => {
    const doFetch = vi.fn<HttpFetch>();
    await expect(lookupRate("2026-02-30", NOW, doFetch)).resolves.toMatchObject({
      message: "Pick a day to look up.",
    });
    await expect(lookupRate("2026-10-09", NOW, doFetch)).resolves.toMatchObject({
      message: "Pick today or a day in the past.",
    });
    await expect(lookupRate("2024-01-01", NOW, doFetch)).resolves.toMatchObject({
      message: "Rates are available from Mar 2, 2024 on.",
    });
    expect(doFetch).not.toHaveBeenCalled();
  });
});
