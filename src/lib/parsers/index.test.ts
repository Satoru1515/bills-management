import { describe, expect, it } from "vitest";
import * as apap from "./__fixtures__/apap";
import * as bsc from "./__fixtures__/bsc";
import * as paypal from "./__fixtures__/paypal";
import * as scotiabank from "./__fixtures__/scotiabank";
import { parseApap } from "./apap";
import { parseBsc } from "./bsc";
import { parseEmail, senderAddress } from "./index";
import { parsePaypal } from "./paypal";
import { parseScotiabank } from "./scotiabank";

describe("senderAddress", () => {
  it.each([
    ["Scotiabank <alertas@scotiabank.com>", "alertas@scotiabank.com"],
    ['"PayPal" <Service@Intl.PayPal.com>', "service@intl.paypal.com"],
    ["  no-reply@apap.com.do  ", "no-reply@apap.com.do"],
    ['"alertas@scotiabank.com" <someone@else.com>', "someone@else.com"],
  ])("reads %s", (from, expected) => {
    expect(senderAddress(from)).toBe(expected);
  });

  it.each(["", "Scotiabank", "Scotiabank <>", "Scotiabank <not an address>"])(
    "returns null for %j",
    (from) => {
      expect(senderAddress(from)).toBeNull();
    },
  );
});

describe("parseEmail", () => {
  it.each([
    ["Scotiabank", scotiabank.creditCardUse, parseScotiabank],
    ["APAP", apap.contactless, parseApap],
    ["Banco Santa Cruz", bsc.consumption, parseBsc],
    ["PayPal", paypal.spotify, parsePaypal],
  ] as const)("routes a %s purchase to its parser", (bank, email, parser) => {
    const parsed = parseEmail(email);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(parser(email));
    expect(parsed).toMatchObject({ bank, gmailMessageId: email.id, kind: "consumo" });
  });

  it("matches the sender address without regard to case", () => {
    const email = { ...bsc.consumption, from: "BSC <Notificaciones@BSC.com.do>" };
    expect(parseEmail(email)).toMatchObject({ bank: "Banco Santa Cruz" });
  });

  it("returns null for a non-purchase email from a known sender", () => {
    expect(parseEmail(scotiabank.paymentReceived)).toBeNull();
    expect(parseEmail(paypal.moneyReceived)).toBeNull();
  });

  it.each([
    ["an unknown sender", "Banco Popular <alertas@bpd.com.do>"],
    ["a look-alike domain", "Scotiabank <alertas@scotiabank.com.evil.test>"],
    ["a display name that looks like a known sender", '"alertas@scotiabank.com" <x@evil.test>'],
    ["a sender name without an address", "Scotiabank"],
  ])("returns null for %s", (_label, from) => {
    expect(parseEmail({ ...scotiabank.creditCardUse, from })).toBeNull();
  });
});
