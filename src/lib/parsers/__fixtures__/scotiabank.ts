import type { RawEmail } from "@/lib/domain/types";

/**
 * Scotiabank alert emails modeled on real ones (amounts and merchants changed).
 * `date` is Gmail's receive time in UTC; bodies are plain text as the Gmail client will produce.
 */

const FROM = "Scotiabank <alertas@scotiabank.com>";
const FOOTER =
  "Si usted no lo hizo, comuníquese con nosotros al número al dorso de su tarjeta.\n\nScotiabank República Dominicana.";

function email(id: string, subject: string, date: string, body: string): RawEmail {
  return {
    id,
    threadId: `thread-${id}`,
    from: FROM,
    subject,
    date,
    // Gmail snippets are the first ~200 characters of the body flattened to one line.
    snippet: body.replace(/\s+/g, " ").slice(0, 200),
    body: `${body}\n\n${FOOTER}`,
  };
}

/** 07:35 pm on 2026-10-04 (DR) = 23:35 UTC. */
export const creditCardUse = email(
  "sc-use-1",
  "Uso de tarjeta de crédito",
  "2026-10-04T23:35:41.000Z",
  "Hola SATORU,\nSe realizó una autorización por un monto de $5,986.90 DOP en SUPERM. NACIONAL MAXIM con su Tarjeta de Crédito Scotiabank ***7341 a las 07:35 pm AST",
);

export const outsideCountry = email(
  "sc-abroad-1",
  "Autorización fuera del país",
  "2026-10-05T14:02:10.000Z",
  "Hola SATORU,\nSe realizó una autorización fuera del país por un monto de $11.99 USD en SPOTIFY P2F8A1B2C3 con su Tarjeta de Crédito Scotiabank ***1842 a las 10:01 am AST",
);

export const cardNotPresent = email(
  "sc-cnp-1",
  "Autorización sin tarjeta de crédito presente",
  "2026-10-05T16:20:00.000Z",
  "Hola SATORU,\nSe realizó una autorización sin su Tarjeta de Crédito Scotiabank presente por un monto de $1,250.00 DOP en UBER RIDES con su tarjeta ***7341 a las 12:19 pm AST",
);

export const billPayment = email(
  "sc-bill-1",
  "Pago de factura realizado",
  "2026-10-06T16:59:30.000Z",
  "Hola SATORU,\nSe realizó un pago de factura desde tu Tarjeta de Crédito por un cantidad de $2,251.46 DOP en la tarjeta ***7341 a las 12:59 pm AST",
);

/** Bought at 11:58 pm on 2026-10-06 (DR), received at 12:01 am on 2026-10-07 (DR). */
export const aroundMidnight = email(
  "sc-midnight-1",
  "Uso de tarjeta de crédito",
  "2026-10-07T04:01:05.000Z",
  "Hola SATORU,\nSe realizó una autorización por un monto de $450.00 DOP en HOT DOG EL TIGRE con su Tarjeta de Crédito Scotiabank ***1842 a las 11:58 pm AST",
);

export const paymentReceived = email(
  "sc-paid-1",
  "Pago recibido",
  "2026-10-03T13:00:00.000Z",
  "Hola SATORU,\nRecibimos un pago a su Tarjeta de Crédito Scotiabank ***7341 por un monto de $10,000.00 DOP el 03/10/2026.",
);

export const instantPaymentReceived = email(
  "sc-instant-1",
  "Pago al Instante recibido",
  "2026-10-03T15:30:00.000Z",
  "Hola SATORU,\nHa recibido un crédito a su cuenta por un monto de $3,000.00 DOP mediante Pago al Instante.",
);

export const cardVerification = email(
  "sc-verify-1",
  "Autorización fuera del país",
  "2026-10-02T18:10:00.000Z",
  "Hola SATORU,\nSe realizó una autorización fuera del país por un monto de $0.10 USD en ANTHROPIC con su Tarjeta de Crédito Scotiabank ***1842 a las 02:09 pm AST",
);

export const digitalWallet = email(
  "sc-wallet-1",
  "Configuración de billetera digital",
  "2026-10-01T12:00:00.000Z",
  "Hola SATORU,\nTu código para configurar tu billetera digital es 123456. No lo compartas con nadie.",
);

/**
 * One purchase reported three times, once per subject (as Scotiabank does), received over
 * two minutes, oldest first. The card-not-present email arrives first.
 */
export const repeatedPurchase = [
  email(
    "sc-dup-cnp",
    "Autorización sin tarjeta de crédito presente",
    "2026-10-06T22:14:20.000Z",
    "Hola SATORU,\nSe realizó una autorización sin su Tarjeta de Crédito Scotiabank presente por un monto de $3,420.00 DOP en AMAZON MKTPLACE PMTS con su tarjeta ***7341 a las 06:14 pm AST",
  ),
  email(
    "sc-dup-use",
    "Uso de tarjeta de crédito",
    "2026-10-06T22:15:02.000Z",
    "Hola SATORU,\nSe realizó una autorización por un monto de $3,420.00 DOP en AMAZON MKTPLACE PMTS con su Tarjeta de Crédito Scotiabank ***7341 a las 06:15 pm AST",
  ),
  email(
    "sc-dup-abroad",
    "Autorización fuera del país",
    "2026-10-06T22:16:30.000Z",
    "Hola SATORU,\nSe realizó una autorización fuera del país por un monto de $3,420.00 DOP en AMAZON MKTPLACE PMTS con su Tarjeta de Crédito Scotiabank ***7341 a las 06:16 pm AST",
  ),
] as const;

/** A second, real purchase with the same card, amount and merchant 20 minutes later. */
export const repeatedPurchaseLater = email(
  "sc-dup-later",
  "Uso de tarjeta de crédito",
  "2026-10-06T22:35:10.000Z",
  "Hola SATORU,\nSe realizó una autorización por un monto de $3,420.00 DOP en AMAZON MKTPLACE PMTS con su Tarjeta de Crédito Scotiabank ***7341 a las 06:35 pm AST",
);
