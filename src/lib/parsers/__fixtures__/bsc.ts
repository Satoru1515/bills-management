import type { RawEmail } from "@/lib/domain/types";

/**
 * Banco Santa Cruz notification emails modeled on real ones (amounts and merchants changed).
 * `date` is Gmail's receive time in UTC; bodies are plain text as the Gmail client will produce.
 */

const FROM = "Banco Santa Cruz <notificaciones@bsc.com.do>";
const SUBJECT = "Notificación, Banco Santa Cruz";
const FOOTER =
  "Si no reconoces esta transacción, comunícate con nosotros al 809-726-2222.\n\nBanco Santa Cruz. Este es un correo automático, por favor no respondas.";

function email(id: string, date: string, body: string): RawEmail {
  return {
    id,
    threadId: "thread-bsc-2026-10",
    from: FROM,
    subject: SUBJECT,
    date,
    // Gmail snippets are the first ~200 characters of the body flattened to one line.
    snippet: body.replace(/\s+/g, " ").slice(0, 200),
    body: `${body}\n\n${FOOTER}`,
  };
}

interface Detail {
  heading?: string;
  card?: string;
  amount: string;
  place: string;
  dateTime: string;
  status: string;
}

function purchase(d: Detail): string {
  return [
    d.heading ?? "NOTIFICACIÓN DE consumo",
    "Estimado (a) cliente.",
    "Gracias por utilizar nuestros servicios.",
    `Te notificamos que desde tu tarjeta de Crédito Gold terminada en ${d.card ?? "9236"}`,
    "fue realizada la siguiente transacción:",
    "",
    `Monto: ${d.amount}`,
    `Lugar de transacción: ${d.place}`,
    `Fecha y hora: ${d.dateTime}`,
    `Estado: ${d.status}`,
  ].join("\n");
}

/** The example from docs/parsing-spec.md §3: 23:18 on 6 Oct 2026 (DR) = 03:18 UTC on 7 Oct. */
export const consumption = email(
  "bsc-consumo-1",
  "2026-10-07T03:18:40.000Z",
  purchase({
    amount: "RD$ 394.00",
    place: "SM BRAVO LAS AMERICAS SANTO DOMINGODO",
    dateTime: "6/10/2026 23:18:05",
    status: "Aprobada",
  }),
);

export const usdWithThousands = email(
  "bsc-usd-1",
  "2026-10-05T15:02:11.000Z",
  purchase({
    amount: "US$ 1,045.50",
    place: "  AIRBNB * HMZ3K2P   SAN FRANCISCOUS  ",
    dateTime: "5/10/2026 11:01:59",
    status: "Aprobada",
  }),
);

/** "terminada en" split across two lines, as the HTML-to-text conversion sometimes produces. */
export const splitCardEnding = email(
  "bsc-split-1",
  "2026-10-04T18:30:00.000Z",
  purchase({
    amount: "RD$ 2,150.75",
    place: "SHELL LOS PRADOS SANTO DOMINGODO",
    dateTime: "4/10/2026 14:29:30",
    status: "Aprobada",
  }).replace("terminada en ", "terminada\nen "),
);

export const declined = email(
  "bsc-declined-1",
  "2026-10-03T20:00:00.000Z",
  purchase({
    amount: "RD$ 12,000.00",
    place: "IKEA SANTO DOMINGODO",
    dateTime: "3/10/2026 15:59:10",
    status: "Rechazada",
  }),
);

export const transferReceived = email(
  "bsc-transfer-1",
  "2026-10-02T13:15:00.000Z",
  [
    "NOTIFICACIÓN DE Transferencia recibida",
    "Estimado (a) cliente.",
    "Te notificamos que recibiste una transferencia para el pago de tu tarjeta de Crédito Gold terminada en 9236:",
    "",
    "Monto: RD$ 20,000.00",
    "Fecha y hora: 2/10/2026 09:14:22",
    "Estado: Aplicada",
  ].join("\n"),
);

export const cashback = email(
  "bsc-cashback-1",
  "2026-10-01T16:00:00.000Z",
  [
    "NOTIFICACIÓN DE devolución",
    "Estimado (a) cliente.",
    "Te notificamos que se acreditó una devolución de cashback a tu tarjeta de Crédito Gold terminada en 9236:",
    "",
    "Monto: RD$ 185.40",
    "Fecha y hora: 1/10/2026 12:00:00",
    "Estado: Aprobada",
  ].join("\n"),
);
