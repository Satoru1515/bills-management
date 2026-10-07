import { describe, expect, it } from "vitest";
import * as fixtures from "./__fixtures__/scotiabank";
import { BILL_PAYMENT_MERCHANT, parseScotiabank } from "./scotiabank";

describe("parseScotiabank", () => {
  it("parses a credit card use alert", () => {
    expect(parseScotiabank(fixtures.creditCardUse)).toEqual({
      gmailMessageId: "sc-use-1",
      date: "2026-10-04T19:35:00-04:00",
      month: "2026-10",
      bank: "Scotiabank",
      cardLast4: "7341",
      amount: 5986.9,
      currency: "DOP",
      merchant: "SUPERM. NACIONAL MAXIM",
      kind: "consumo",
    });
  });

  it("parses an authorization outside the country in USD", () => {
    expect(parseScotiabank(fixtures.outsideCountry)).toMatchObject({
      date: "2026-10-05T10:01:00-04:00",
      cardLast4: "1842",
      amount: 11.99,
      currency: "USD",
      merchant: "SPOTIFY P2F8A1B2C3",
    });
  });

  it("parses a card-not-present authorization", () => {
    expect(parseScotiabank(fixtures.cardNotPresent)).toMatchObject({
      date: "2026-10-05T12:19:00-04:00",
      cardLast4: "7341",
      amount: 1250,
      currency: "DOP",
      merchant: "UBER RIDES",
    });
  });

  it("parses a bill payment as a purchase", () => {
    expect(parseScotiabank(fixtures.billPayment)).toMatchObject({
      date: "2026-10-06T12:59:00-04:00",
      cardLast4: "7341",
      amount: 2251.46,
      currency: "DOP",
      merchant: BILL_PAYMENT_MERCHANT,
    });
  });

  it("uses the previous day for a purchase just before midnight", () => {
    expect(parseScotiabank(fixtures.aroundMidnight)).toMatchObject({
      date: "2026-10-06T23:58:00-04:00",
      month: "2026-10",
    });
  });

  it("falls back to the snippet when the body is empty", () => {
    const parsed = parseScotiabank({ ...fixtures.creditCardUse, body: "" });
    expect(parsed).toMatchObject({ amount: 5986.9, merchant: "SUPERM. NACIONAL MAXIM" });
  });

  it.each([
    ["payment received", fixtures.paymentReceived],
    ["instant payment received", fixtures.instantPaymentReceived],
    ["$0.10 USD card verification", fixtures.cardVerification],
    ["digital wallet setup", fixtures.digitalWallet],
  ])("ignores %s", (_label, email) => {
    expect(parseScotiabank(email)).toBeNull();
  });

  it("returns null when the text does not match any known format", () => {
    expect(
      parseScotiabank({ ...fixtures.creditCardUse, body: "Hola SATORU, gracias por preferirnos." }),
    ).toBeNull();
  });

  it("returns null when the receive date is invalid", () => {
    expect(parseScotiabank({ ...fixtures.creditCardUse, date: "not a date" })).toBeNull();
  });
});
