import { describe, expect, it } from "vitest";
import * as apap from "../parsers/__fixtures__/apap";
import * as paypal from "../parsers/__fixtures__/paypal";
import * as scotiabank from "../parsers/__fixtures__/scotiabank";
import { parseEmail } from "../parsers";
import { dedupeScotiabank, type ParsedMessage } from "./dedupe";
import type { ParsedEmail, RawEmail } from "./types";

function message(raw: RawEmail, overrides: Partial<ParsedEmail> = {}): ParsedMessage {
  const parsed = parseEmail(raw);
  if (!parsed) throw new Error(`fixture ${raw.id} does not parse`);
  return { raw, parsed: { ...parsed, ...overrides } };
}

/** Same purchase as `raw`, reported under another subject and received `seconds` later. */
function resent(raw: RawEmail, id: string, subject: string, seconds: number): RawEmail {
  const date = new Date(Date.parse(raw.date) + seconds * 1000).toISOString();
  return { ...raw, id, subject, date };
}

const ids = (messages: readonly ParsedMessage[]) => messages.map((m) => m.raw.id);
const [cnp, use, abroad] = scotiabank.repeatedPurchase;

describe("dedupeScotiabank", () => {
  it("keeps the 'Uso de tarjeta de crédito' alert of a purchase reported three times", () => {
    const { kept, dropped } = dedupeScotiabank([cnp, use, abroad].map((raw) => message(raw)));
    expect(ids(kept)).toEqual(["sc-dup-use"]);
    expect(ids(dropped)).toEqual(["sc-dup-cnp", "sc-dup-abroad"]);
  });

  it("does not depend on input order", () => {
    const { kept, dropped } = dedupeScotiabank([abroad, use, cnp].map((raw) => message(raw)));
    expect(ids(kept)).toEqual(["sc-dup-use"]);
    expect(ids(dropped)).toEqual(["sc-dup-abroad", "sc-dup-cnp"]);
  });

  it("keeps the first received alert when there is no 'Uso de tarjeta de crédito' one", () => {
    const { kept, dropped } = dedupeScotiabank([abroad, cnp].map((raw) => message(raw)));
    expect(ids(kept)).toEqual(["sc-dup-cnp"]);
    expect(ids(dropped)).toEqual(["sc-dup-abroad"]);
  });

  it("keeps the alert already stored by an earlier sync over the preferred subject", () => {
    const all = [cnp, use, abroad].map((raw) => message(raw));
    const stored = new Set(["sc-dup-cnp"]);
    const { kept, dropped } = dedupeScotiabank(all, { isStored: (m) => stored.has(m.raw.id) });
    expect(ids(kept)).toEqual(["sc-dup-cnp"]);
    expect(ids(dropped)).toEqual(["sc-dup-use", "sc-dup-abroad"]);
  });

  it("keeps a second real purchase of the same amount outside the 2 minute window", () => {
    const all = [cnp, use, abroad, scotiabank.repeatedPurchaseLater].map((raw) => message(raw));
    const { kept } = dedupeScotiabank(all);
    expect(ids(kept)).toEqual(["sc-dup-use", "sc-dup-later"]);
  });

  it("treats exactly 2 minutes apart as the same purchase, and 3 minutes as different", () => {
    const base = message(scotiabank.creditCardUse);
    const twoMin = message(
      resent(scotiabank.creditCardUse, "two", "Autorización fuera del país", 120),
      { date: "2026-10-04T19:37:00-04:00" },
    );
    const threeMin = message(
      resent(scotiabank.creditCardUse, "three", "Autorización fuera del país", 180),
      { date: "2026-10-04T19:38:00-04:00" },
    );
    expect(ids(dedupeScotiabank([base, twoMin]).kept)).toEqual(["sc-use-1"]);
    expect(ids(dedupeScotiabank([base, threeMin]).kept)).toEqual(["sc-use-1", "three"]);
  });

  it("never collapses two alerts with the same subject (two real purchases)", () => {
    const first = message(scotiabank.creditCardUse);
    const second = message(
      resent(scotiabank.creditCardUse, "again", "Uso de tarjeta de crédito", 30),
    );
    expect(ids(dedupeScotiabank([first, second]).kept)).toEqual(["sc-use-1", "again"]);
  });

  it.each([
    ["card", { cardLast4: "1842" }],
    ["amount", { amount: 5986.91 }],
    ["currency", { currency: "USD" }],
    ["merchant", { merchant: "SUPERM. NACIONAL CHURCHILL" }],
  ] as const)("keeps both when the %s differs", (_field, overrides) => {
    const first = message(scotiabank.creditCardUse);
    const other = message(
      resent(scotiabank.creditCardUse, "other", "Autorización fuera del país", 20),
      overrides,
    );
    expect(dedupeScotiabank([first, other]).dropped).toEqual([]);
  });

  it("compares merchants ignoring case, accents and spacing", () => {
    const first = message(scotiabank.creditCardUse);
    const other = message(
      resent(scotiabank.creditCardUse, "other", "Autorización fuera del país", 20),
      { merchant: "superm.  nacional máxim" },
    );
    expect(ids(dedupeScotiabank([other, first]).kept)).toEqual(["sc-use-1"]);
  });

  it("leaves other banks untouched, even with identical purchase data", () => {
    const scotia = message(scotiabank.creditCardUse);
    const apapCopy = message(apap.contactless, { ...scotia.parsed, bank: "APAP" });
    const paypalCopy = message(paypal.spotify, { ...scotia.parsed, bank: "PayPal" });
    const all = [apapCopy, scotia, paypalCopy];
    const { kept, dropped } = dedupeScotiabank(all);
    expect(kept).toEqual(all);
    expect(dropped).toEqual([]);
  });

  it("keeps messages whose purchase date cannot be read", () => {
    const first = message(scotiabank.creditCardUse);
    const broken = message(
      resent(scotiabank.creditCardUse, "broken", "Autorización fuera del país", 10),
      { date: "not a date" },
    );
    expect(ids(dedupeScotiabank([first, broken]).kept)).toEqual(["sc-use-1", "broken"]);
  });

  it("returns empty lists for no messages and preserves extra fields", () => {
    expect(dedupeScotiabank([])).toEqual({ kept: [], dropped: [] });
    const tagged = { ...message(scotiabank.creditCardUse), tag: "x" };
    expect(dedupeScotiabank([tagged]).kept[0]).toBe(tagged);
  });
});
