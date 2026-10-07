import type { RawEmail } from "@/lib/domain/types";

/**
 * APAP notification emails modeled on real ones (amounts, merchants and balances changed).
 * `date` is Gmail's receive time in UTC; bodies are plain text as the Gmail client will produce,
 * with the HTML table cells separated by `|`.
 */

const FROM = "APAP <no-reply@apap.com.do>";
const SUBJECT = "APAP, Notificaciones";
const FOOTER =
  "Si no reconoces esta transacción, llámanos al 809-689-0171.\n\nAsociación Popular de Ahorros y Préstamos.";

function email(
  id: string,
  date: string,
  body: string,
  overrides: Partial<RawEmail> = {},
): RawEmail {
  return {
    id,
    threadId: "thread-apap-2026-10",
    from: FROM,
    subject: SUBJECT,
    date,
    // Gmail snippets are the first ~200 characters of the body flattened to one line.
    snippet: body.replace(/\s+/g, " ").slice(0, 200),
    body: `${body}\n\n${FOOTER}`,
    ...overrides,
  };
}

interface Detail {
  date: string;
  time: string;
  currency: string;
  amount: string;
  merchant: string;
  status: string;
}

function table(d: Detail, balance = "RD$ 48,215.33"): string {
  return [
    "Detalle de la transacción",
    `Fecha: | ${d.date}`,
    `Hora: | ${d.time}`,
    `Moneda: | ${d.currency}`,
    `Monto: | ${d.amount}`,
    `Comercio: | ${d.merchant}`,
    `Estado: | ${d.status}`,
    `Balance disponible: | ${balance}`,
  ].join("\n");
}

function purchase(kind: string, d: Detail): string {
  return (
    `Hola YANO ROMERO/SATORU, Tu titular Visa Platinum terminada en 5977 presenta una transacción ${kind} con el siguiente detalle:\n` +
    table(d)
  );
}

/** The example from docs/parsing-spec.md §2: 20:07 on 4 Oct 2026 (DR) = 00:07 UTC on 5 Oct. */
export const contactless = email(
  "apap-contactless-1",
  "2026-10-05T00:07:52.000Z",
  purchase("contactless", {
    date: "4/10/2026",
    time: "20:7",
    currency: "RD pesos dominicanos",
    amount: "920.00",
    merchant: "BURGER KING SAN ISIDRO",
    status: "Transacción Aprobada",
  }),
);

export const onlineUsd = email(
  "apap-online-1",
  "2026-10-06T13:05:20.000Z",
  purchase("sin presencia de plástico", {
    date: "6/10/2026",
    time: "9:5",
    currency: "US dólares estadounidenses",
    amount: "1,250.00",
    merchant: "AMAZON MKTPL*ZK4LP0",
    status: "Transacción Aprobada",
  }),
);

/** Same purchase rendered without pipes, each label and value on its own line. */
export const splitLines = email(
  "apap-split-1",
  "2026-10-06T22:41:00.000Z",
  "Hola YANO ROMERO/SATORU, Tu titular Visa Platinum terminada en\n5977 presenta una transacción contactless con el siguiente detalle:\n" +
    "Detalle de la transacción\nFecha:\n6/10/2026\nHora:\n18:40\nMoneda:\nRD pesos dominicanos\nMonto:\n2,310.45\nComercio:\nFARMACIA CAROL   NACO\nEstado:\nTransacción Aprobada\nBalance disponible:\nRD$ 46,000.00",
);

export const declined = email(
  "apap-declined-1",
  "2026-10-03T19:12:00.000Z",
  purchase("sin presencia de plástico", {
    date: "3/10/2026",
    time: "15:11",
    currency: "RD pesos dominicanos",
    amount: "3,400.00",
    merchant: "SHEIN.COM",
    status: "Transacción Declinada",
  }),
);

export const paymentReceived = email(
  "apap-paid-1",
  "2026-10-02T14:00:00.000Z",
  "Hola YANO ROMERO/SATORU, Hemos recibido un pago a tu tarjeta Visa Platinum terminada en 5977 con el siguiente detalle:\n" +
    "Fecha: | 2/10/2026\nMonto: | 15,000.00\nEstado: | Pago Aplicado",
);

export const paymentReminder = email(
  "apap-reminder-1",
  "2026-10-01T12:30:00.000Z",
  "Hola YANO ROMERO/SATORU, Te recordamos que la fecha límite de pago de tu tarjeta Visa Platinum terminada en 5977 es el 15/10/2026. Pago mínimo: RD$ 2,500.00",
);

/** OTP emails sometimes arrive from the upper-case sender. */
export const otpCode = email(
  "apap-otp-1",
  "2026-10-01T16:45:00.000Z",
  "Hola YANO ROMERO/SATORU, Tu código de verificación para activar tu billetera digital es 482913. No lo compartas con nadie.",
  { from: "APAP <NO-REPLY@apap.com.do>" },
);
