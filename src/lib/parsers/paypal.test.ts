import { describe, expect, it } from "vitest";
import * as fixtures from "./__fixtures__/paypal";
import { parsePaypal } from "./paypal";

describe("parsePaypal", () => {
  it("parses a payment receipt with the reception time of day", () => {
    expect(parsePaypal(fixtures.spotify)).toEqual({
      gmailMessageId: "paypal-spotify-1",
      date: "2026-10-04T10:22:31-04:00",
      month: "2026-10",
      bank: "PayPal",
      cardLast4: "7782",
      amount: 11.99,
      currency: "USD",
      merchant: "Spotify AB",
      kind: "consumo",
    });
  });

  it("reads 'Sept', a thousands separator and a Mastercard", () => {
    expect(parsePaypal(fixtures.septWithThousands)).toMatchObject({
      date: "2026-09-30T19:45:00-04:00",
      month: "2026-09",
      cardLast4: "1234",
      amount: 1204.5,
      merchant: "Steam Games",
    });
  });

  it("uses the transaction date even when the email arrives after midnight UTC", () => {
    // Received 01:05 UTC on 2 Oct = 21:05 DR time on 1 Oct.
    expect(parsePaypal(fixtures.paypalBalance)).toMatchObject({
      date: "2026-10-01T21:05:09-04:00",
    });
  });

  it("uses 0000 as the card when paid from the PayPal balance", () => {
    expect(parsePaypal(fixtures.paypalBalance)).toMatchObject({
      cardLast4: "0000",
      amount: 7.99,
      merchant: "Crunchyroll LLC",
    });
  });

  it("parses an automatic payment and keeps the subject's spelling of the merchant", () => {
    expect(parsePaypal(fixtures.automaticPayment)).toMatchObject({
      date: "2026-10-06T08:00:00-04:00",
      amount: 15.49,
      merchant: "Netflix International B.V.",
    });
  });

  it("parses a body flattened to one line with a 'Mon d, yyyy' date", () => {
    expect(parsePaypal(fixtures.flattened)).toEqual({
      ...parsePaypal(fixtures.spotify),
      gmailMessageId: "paypal-flat-1",
    });
  });

  it("falls back to the reception date when there is no transaction date", () => {
    expect(parsePaypal(fixtures.noTransactionDate)).toMatchObject({
      date: "2026-10-04T10:22:31-04:00",
    });
  });

  it("accepts CRLF line breaks and non-breaking spaces", () => {
    const body = fixtures.spotify.body
      .replace(/\n/g, "\r\n")
      .replace("$11.99 USD", "$11.99\u00a0USD");
    expect(parsePaypal({ ...fixtures.spotify, body })).toMatchObject({ amount: 11.99 });
  });

  it("drops the body sentence's final period when the subject has none", () => {
    const body = fixtures.spotify.body.replace("to Spotify AB\n", "to Spotify AB.\n");
    expect(body).not.toBe(fixtures.spotify.body);
    expect(parsePaypal({ ...fixtures.spotify, body })).toMatchObject({ merchant: "Spotify AB" });
  });

  it("uses the subject's merchant when the body has none", () => {
    const body = fixtures.flattened.body.replace("to Spotify AB Transaction", "to Transaction");
    expect(parsePaypal({ ...fixtures.flattened, body })).toMatchObject({ merchant: "Spotify AB" });
  });

  it.each([
    ["money received", fixtures.moneyReceived],
    ["a refund", fixtures.refund],
    ["a promotion", fixtures.promotion],
    ["a currency other than USD or DOP", fixtures.euros],
  ])("ignores %s", (_label, email) => {
    expect(parsePaypal(email)).toBeNull();
  });

  it("ignores a 'You paid' body when the subject is not a receipt", () => {
    expect(parsePaypal({ ...fixtures.spotify, subject: "Your PayPal account" })).toBeNull();
  });

  it("returns null when the body is empty, even if the snippet has the payment", () => {
    expect(parsePaypal({ ...fixtures.spotify, body: "" })).toBeNull();
  });

  it.each([
    ["the amount is invalid", "You paid $11.99 USD", "You paid $11.9.9 USD"],
    ["the transaction date is not a real day", "4 Oct 2026", "31 Sep 2026"],
    ["the transaction month is unknown", "4 Oct 2026", "4 Okt 2026"],
  ])("returns null when %s", (_label, from, to) => {
    const body = fixtures.spotify.body.replace(from, to);
    expect(body).not.toBe(fixtures.spotify.body);
    expect(parsePaypal({ ...fixtures.spotify, body })).toBeNull();
  });

  it("returns null when the received date is not a timestamp", () => {
    expect(parsePaypal({ ...fixtures.spotify, date: "yesterday" })).toBeNull();
  });
});
