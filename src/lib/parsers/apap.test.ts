import { describe, expect, it } from "vitest";
import * as fixtures from "./__fixtures__/apap";
import { parseApap } from "./apap";

describe("parseApap", () => {
  it("parses a contactless purchase and never returns the balance", () => {
    expect(parseApap(fixtures.contactless)).toEqual({
      gmailMessageId: "apap-contactless-1",
      date: "2026-10-04T20:07:00-04:00",
      month: "2026-10",
      bank: "APAP",
      cardLast4: "5977",
      amount: 920,
      currency: "DOP",
      merchant: "BURGER KING SAN ISIDRO",
      kind: "consumo",
    });
  });

  it("parses an online purchase in USD with a thousands separator", () => {
    expect(parseApap(fixtures.onlineUsd)).toMatchObject({
      date: "2026-10-06T09:05:00-04:00",
      cardLast4: "5977",
      amount: 1250,
      currency: "USD",
      merchant: "AMAZON MKTPL*ZK4LP0",
    });
  });

  it("parses a table rendered with labels and values on separate lines", () => {
    expect(parseApap(fixtures.splitLines)).toMatchObject({
      date: "2026-10-06T18:40:00-04:00",
      cardLast4: "5977",
      amount: 2310.45,
      currency: "DOP",
      merchant: "FARMACIA CAROL NACO",
    });
  });

  it("accepts CRLF line breaks, non-breaking spaces and a currency prefix on the amount", () => {
    const body = fixtures.contactless.body
      .replace(/\n/g, "\r\n")
      .replace("Comercio: | ", "Comercio: | ")
      .replace("Monto: | 920.00", "Monto: | RD$ 920.00");
    expect(parseApap({ ...fixtures.contactless, body })).toMatchObject({
      amount: 920,
      merchant: "BURGER KING SAN ISIDRO",
    });
  });

  it.each([
    ["a declined purchase", fixtures.declined],
    ["a payment received", fixtures.paymentReceived],
    ["a payment reminder", fixtures.paymentReminder],
    ["an OTP / wallet activation code", fixtures.otpCode],
  ])("ignores %s", (_label, email) => {
    expect(parseApap(email)).toBeNull();
  });

  it("ignores a status that says it was not approved", () => {
    const body = fixtures.contactless.body.replace(
      "Transacción Aprobada",
      "Transacción No Aprobada",
    );
    expect(parseApap({ ...fixtures.contactless, body })).toBeNull();
  });

  it("returns null when the body is empty, even if the snippet has the first sentence", () => {
    expect(parseApap({ ...fixtures.contactless, body: "" })).toBeNull();
  });

  it.each([
    ["the merchant cell is empty", "Comercio: | BURGER KING SAN ISIDRO", "Comercio: |"],
    ["the date is not a real day", "Fecha: | 4/10/2026", "Fecha: | 31/9/2026"],
    ["the time is invalid", "Hora: | 20:7", "Hora: | 25:7"],
    ["the currency is unknown", "Moneda: | RD pesos dominicanos", "Moneda: | Euros"],
    ["the amount is invalid", "Monto: | 920.00", "Monto: | N/D"],
    ["the card number is missing", "terminada en 5977", "terminada en"],
  ])("returns null when %s", (_label, from, to) => {
    const body = fixtures.contactless.body.replace(from, to);
    expect(body).not.toBe(fixtures.contactless.body);
    expect(parseApap({ ...fixtures.contactless, body })).toBeNull();
  });
});
