import { describe, expect, it } from "vitest";
import * as fixtures from "./__fixtures__/bsc";
import { parseBsc } from "./bsc";

describe("parseBsc", () => {
  it("parses a purchase in pesos", () => {
    expect(parseBsc(fixtures.consumption)).toEqual({
      gmailMessageId: "bsc-consumo-1",
      date: "2026-10-06T23:18:05-04:00",
      month: "2026-10",
      bank: "Banco Santa Cruz",
      cardLast4: "9236",
      amount: 394,
      currency: "DOP",
      merchant: "SM BRAVO LAS AMERICAS SANTO DOMINGODO",
      kind: "consumo",
    });
  });

  it("parses a purchase in dollars with a thousands separator and trims the merchant", () => {
    expect(parseBsc(fixtures.usdWithThousands)).toMatchObject({
      date: "2026-10-05T11:01:59-04:00",
      amount: 1045.5,
      currency: "USD",
      merchant: "AIRBNB * HMZ3K2P SAN FRANCISCOUS",
    });
  });

  it("reads the card when 'terminada en' is split across two lines", () => {
    expect(parseBsc(fixtures.splitCardEnding)).toMatchObject({
      cardLast4: "9236",
      amount: 2150.75,
      merchant: "SHELL LOS PRADOS SANTO DOMINGODO",
    });
  });

  it("accepts an unaccented upper-case heading and CRLF line breaks", () => {
    const body = fixtures.consumption.body
      .replace("NOTIFICACIÓN DE consumo", "NOTIFICACION DE CONSUMO")
      .replace(/\n/g, "\r\n");
    expect(parseBsc({ ...fixtures.consumption, body })).toMatchObject({ amount: 394 });
  });

  it.each([
    ["a declined purchase", fixtures.declined],
    ["a transfer received", fixtures.transferReceived],
    ["a cashback refund", fixtures.cashback],
  ])("ignores %s", (_label, email) => {
    expect(parseBsc(email)).toBeNull();
  });

  it("returns null when the body is empty, even if the snippet has the heading", () => {
    expect(parseBsc({ ...fixtures.consumption, body: "" })).toBeNull();
  });

  it.each([
    ["the currency prefix is unknown", "Monto: RD$ 394.00", "Monto: € 394.00"],
    ["the amount is invalid", "Monto: RD$ 394.00", "Monto: RD$ N/D"],
    ["the place is empty", "SM BRAVO LAS AMERICAS SANTO DOMINGODO", ""],
    ["the date is not a real day", "6/10/2026 23:18:05", "31/9/2026 23:18:05"],
    ["the time is missing", "6/10/2026 23:18:05", "6/10/2026"],
    ["the date has extra text", "6/10/2026 23:18:05", "6/10/2026 11:18:05 PM"],
    ["the card number is missing", "terminada en 9236", "terminada en"],
    ["the status is missing", "Estado: Aprobada", ""],
  ])("returns null when %s", (_label, from, to) => {
    const body = fixtures.consumption.body.replace(from, to);
    expect(body).not.toBe(fixtures.consumption.body);
    expect(parseBsc({ ...fixtures.consumption, body })).toBeNull();
  });
});
