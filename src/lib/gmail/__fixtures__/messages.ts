import type { GmailMessage, GmailMessagePart } from "../mime";

/**
 * Gmail API messages (`users.messages.get`, `format=full`) modeled on the bank emails in
 * src/lib/parsers/__fixtures__ (same amounts and merchants), in the MIME shapes Gmail
 * returns: multipart/alternative, HTML only in ISO-8859-1, nested layout tables, an empty
 * text/plain part, attached files and a body stored as an attachment.
 */

export function b64url(text: string, encoding: BufferEncoding = "utf8"): string {
  return Buffer.from(text, encoding).toString("base64url");
}

function header(name: string, value: string) {
  return { name, value };
}

function textPart(
  mimeType: "text/plain" | "text/html",
  content: string,
  charset: "UTF-8" | "ISO-8859-1" = "UTF-8",
): GmailMessagePart {
  return {
    mimeType,
    filename: "",
    headers: [header("Content-Type", `${mimeType}; charset="${charset}"`)],
    body: {
      size: content.length,
      data: b64url(content, charset === "UTF-8" ? "utf8" : "latin1"),
    },
  };
}

function ms(iso: string): string {
  return String(Date.parse(iso));
}

const SCOTIABANK_TEXT =
  "Hola SATORU,\nSe realizó una autorización por un monto de $5,986.90 DOP en SUPERM. NACIONAL MAXIM con su Tarjeta de Crédito Scotiabank ***7341 a las 07:35 pm AST\n\nSi usted no lo hizo, comuníquese con nosotros.";

/** multipart/alternative with text/plain and HTML; the subject is an RFC 2047 encoded-word. */
export const scotiabankAlternative: GmailMessage = {
  id: "18f2a0c3d4e5f601",
  threadId: "18f2a0c3d4e5f601",
  internalDate: ms("2026-10-04T23:35:41.000Z"),
  snippet: "Hola SATORU, Se realiz&oacute; una autorizaci&oacute;n por un monto de $5,986.90 DOP",
  payload: {
    mimeType: "multipart/alternative",
    filename: "",
    headers: [
      header("From", "Scotiabank <alertas@scotiabank.com>"),
      header(
        "Subject",
        `=?UTF-8?B?${Buffer.from("Uso de tarjeta de crédito").toString("base64")}?=`,
      ),
      header("Date", "Sun, 4 Oct 2026 19:35:40 -0400"),
    ],
    body: { size: 0 },
    parts: [
      textPart("text/plain", SCOTIABANK_TEXT),
      textPart("text/html", `<p>${SCOTIABANK_TEXT.replace(/\n/g, "<br>")}</p>`),
    ],
  },
};

const APAP_HTML = `<!DOCTYPE html>
<html><head><title>APAP</title><style>td { font-family: Arial; } .x > p { color: red; }</style></head>
<body>
<!-- preheader -->
<div style="display:none">Detalle de tu transacci&oacute;n&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table width="100%"><tr><td>
  <table class="card" align="center">
    <tr><td><img src="https://example.com/logo.png" alt=""></td></tr>
    <tr><td>Hola YANO ROMERO/SATORU, Tu titular Visa Platinum terminada en 5977 presenta una
      transacci&oacute;n contactless con el siguiente detalle:</td></tr>
    <tr><td>
      <table>
        <tr><th colspan="2">Detalle de la transacci&oacute;n</th></tr>
        <tr><td><b>Fecha:</b></td><td>4/10/2026</td></tr>
        <tr><td><b>Hora:</b></td><td>20:7</td></tr>
        <tr><td><b>Moneda:</b></td><td>RD pesos dominicanos</td></tr>
        <tr><td><b>Monto:</b></td><td>920.00</td></tr>
        <tr><td><b>Comercio:</b></td><td>BURGER&nbsp;KING SAN ISIDRO</td></tr>
        <tr><td><b>Estado:</b></td><td>Transacci&oacute;n Aprobada</td></tr>
        <tr><td><b>Balance disponible:</b></td><td>RD$ 48,215.33</td></tr>
      </table>
    </td></tr>
    <tr><td>Si no reconoces esta transacción, llámanos al 809-689-0171.</td></tr>
  </table>
</td></tr></table>
</body></html>`;

/** HTML only, ISO-8859-1, nested layout tables, entities and a hidden preheader. */
export const apapHtmlOnly: GmailMessage = {
  id: "18f2a1b2c3d4e5f6",
  threadId: "18f29fffffff0001",
  internalDate: ms("2026-10-05T00:07:52.000Z"),
  snippet: "Hola YANO ROMERO/SATORU, Tu titular Visa Platinum terminada en 5977",
  payload: {
    ...textPart("text/html", APAP_HTML, "ISO-8859-1"),
    headers: [
      header("From", "APAP <NO-REPLY@apap.com.do>"),
      header("Subject", "APAP, Notificaciones"),
      header("Content-Type", 'text/html; charset="ISO-8859-1"'),
    ],
  },
};

const BSC_HTML = `<html><body><div>
<p><strong>NOTIFICACI&Oacute;N DE consumo</strong></p>
<p>Estimado (a) cliente.<br>Gracias por utilizar nuestros servicios.</p>
<p>Te notificamos que desde tu tarjeta de Cr&eacute;dito Gold terminada en<br>
9236 fue realizada la siguiente transacci&oacute;n:</p>
<p>Monto: RD$ 394.00<br/>
Lugar de transacci&oacute;n: SM BRAVO LAS AMERICAS SANTO DOMINGODO<br />
Fecha y hora: 6/10/2026 23:18:05<br>
Estado: Aprobada</p>
</div></body></html>`;

/** multipart/mixed: alternative with a blank text/plain, the HTML, and an attached PDF. */
export const bscBlankPlainWithAttachment: GmailMessage = {
  id: "18f2b0000000aa01",
  threadId: "18f2b0000000aa00",
  internalDate: ms("2026-10-07T03:18:40.000Z"),
  snippet: "NOTIFICACIÓN DE consumo Estimado (a) cliente.",
  payload: {
    mimeType: "multipart/mixed",
    filename: "",
    headers: [
      header("From", '"Banco Santa Cruz" <notificaciones@bsc.com.do>'),
      header("Subject", "=?ISO-8859-1?Q?Notificaci=F3n,_Banco_Santa_Cruz?="),
    ],
    body: { size: 0 },
    parts: [
      {
        mimeType: "multipart/alternative",
        filename: "",
        headers: [],
        body: { size: 0 },
        parts: [textPart("text/plain", " \r\n "), textPart("text/html", BSC_HTML)],
      },
      {
        mimeType: "text/plain",
        filename: "terminos.txt",
        headers: [
          header("Content-Type", 'text/plain; name="terminos.txt"'),
          header("Content-Disposition", 'attachment; filename="terminos.txt"'),
        ],
        body: { size: 20, attachmentId: "ANGjdJ-terms" },
      },
      {
        mimeType: "application/pdf",
        filename: "estado.pdf",
        headers: [header("Content-Type", 'application/pdf; name="estado.pdf"')],
        body: { size: 1024, attachmentId: "ANGjdJ-pdf" },
      },
    ],
  },
};

export const PAYPAL_TEXT = [
  "Hello, Satoru Yano",
  "You paid $11.99 USD to Spotify AB",
  "",
  "Transaction ID",
  "5M370362P66534715",
  "Transaction date",
  "4 Oct 2026",
  "",
  "Paid Spotify AB with",
  "Visa-7782 | $11.99 USD",
].join("\r\n");

export const PAYPAL_ATTACHMENT_ID = "ANGjdJ-paypal-body/1+x";

/** A text/plain body too large to inline: Gmail returns an attachmentId instead of data. */
export const paypalBodyAsAttachment: GmailMessage = {
  id: "18f2c00000000b01",
  threadId: "18f2c00000000b01",
  internalDate: ms("2026-10-04T14:22:31.000Z"),
  snippet: "You paid $11.99 USD to Spotify AB",
  payload: {
    mimeType: "text/plain",
    filename: "",
    headers: [
      header("From", "PayPal <service@intl.paypal.com>"),
      header("Subject", "Receipt for Your Payment to Spotify AB"),
      header("Content-Type", 'text/plain; charset="UTF-8"'),
    ],
    body: { size: 60000, attachmentId: PAYPAL_ATTACHMENT_ID },
  },
};
