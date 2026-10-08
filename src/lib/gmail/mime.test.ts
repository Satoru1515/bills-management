import { describe, expect, it } from "vitest";
import { parseEmail } from "@/lib/parsers";
import {
  apapHtmlOnly,
  b64url,
  bscBlankPlainWithAttachment,
  scotiabankAlternative,
} from "./__fixtures__/messages";
import {
  decodeBase64Url,
  decodeHtmlEntities,
  decodeMimeWords,
  findTextParts,
  headerValue,
  htmlToText,
  messageBody,
  partsNeedingAttachment,
  toRawEmail,
  type GmailMessagePart,
} from "./mime";

describe("decodeBase64Url", () => {
  it("decodes base64url without padding as UTF-8", () => {
    expect(decodeBase64Url(b64url("Crédito ñ ✓"))).toBe("Crédito ñ ✓");
  });

  it("also accepts the standard alphabet with padding", () => {
    const standard = Buffer.from("¿?>>", "utf8").toString("base64");
    expect(standard).toMatch(/[+/=]/);
    expect(decodeBase64Url(standard)).toBe("¿?>>");
  });

  it("uses the part's charset", () => {
    const latin1 = Buffer.from("Notificación", "latin1").toString("base64url");
    expect(decodeBase64Url(latin1, "ISO-8859-1")).toBe("Notificación");
    expect(decodeBase64Url(b64url("Notificación"), "utf-8")).toBe("Notificación");
  });

  it("falls back to UTF-8 for an unknown charset", () => {
    expect(decodeBase64Url(b64url("Crédito"), "x-made-up")).toBe("Crédito");
  });
});

describe("decodeMimeWords / headerValue", () => {
  it("decodes B and Q encoded-words and joins adjacent ones", () => {
    expect(decodeMimeWords("=?UTF-8?B?QXV0b3JpemFjacOzbg==?=")).toBe("Autorización");
    expect(decodeMimeWords("=?ISO-8859-1?Q?Notificaci=F3n,_Banco?=")).toBe("Notificación, Banco");
    expect(decodeMimeWords("=?UTF-8?Q?Uso_de_?= =?UTF-8?Q?tarjeta?= de crédito")).toBe(
      "Uso de tarjeta de crédito",
    );
  });

  it("leaves plain values alone", () => {
    expect(decodeMimeWords("APAP, Notificaciones")).toBe("APAP, Notificaciones");
  });

  it("finds headers case-insensitively and returns the first", () => {
    const headers = [
      { name: "subject", value: " First " },
      { name: "Subject", value: "Second" },
    ];
    expect(headerValue(headers, "SUBJECT")).toBe("First");
    expect(headerValue(headers, "From")).toBe("");
    expect(headerValue(undefined, "From")).toBe("");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeHtmlEntities("Transacci&oacute;n &amp; &#39;x&#x27; &Ntilde;&nbsp;1")).toBe(
      "Transacción & 'x' Ñ 1",
    );
  });

  it("decodes each entity once and keeps unknown ones", () => {
    expect(decodeHtmlEntities("&amp;lt; &bogus; &#0;")).toBe("&lt; &bogus; &#0;");
  });
});

describe("htmlToText", () => {
  it("separates table cells with | and drops empty layout cells", () => {
    const html =
      "<table><tr><td></td><td><b>Fecha:</b></td><td>4/10/2026</td><td>&nbsp;</td></tr>" +
      "<tr><td>Monto:</td><td> 920.00 </td></tr></table>";
    expect(htmlToText(html)).toBe("Fecha: | 4/10/2026\nMonto: | 920.00");
  });

  it("turns <br> and block elements into line breaks without blank lines", () => {
    expect(htmlToText("<p>Uno<br>Dos<br/>Tres</p><div>Cuatro</div>")).toBe(
      "Uno\nDos\nTres\nCuatro",
    );
  });

  it("removes head, style, script and comments", () => {
    const html =
      "<html><head><title>T</title><style>p > b { x: 1 }</style></head>" +
      "<body><!-- c --><script>var a = '<p>';</script><p>Hola</p></body></html>";
    expect(htmlToText(html)).toBe("Hola");
  });

  it("removes zero-width characters and collapses whitespace in each line", () => {
    expect(htmlToText("<p>  A&zwnj;​   B\t\tC&nbsp;&nbsp;D </p>")).toBe("A B C D");
  });

  it("does not turn decoded entities into tags", () => {
    expect(htmlToText("<p>&lt;b&gt;bold&lt;/b&gt;</p>")).toBe("<b>bold</b>");
  });
});

describe("findTextParts / messageBody", () => {
  it("prefers text/plain inside multipart/alternative", () => {
    const { plain, html } = findTextParts(scotiabankAlternative.payload);
    expect(plain?.mimeType).toBe("text/plain");
    expect(html?.mimeType).toBe("text/html");
    expect(messageBody(scotiabankAlternative.payload)).toContain(
      "Se realizó una autorización por un monto de $5,986.90 DOP",
    );
    expect(messageBody(scotiabankAlternative.payload)).not.toContain("<");
  });

  it("falls back to the HTML when text/plain is blank and skips attached files", () => {
    const { plain } = findTextParts(bscBlankPlainWithAttachment.payload);
    expect(plain?.filename).toBe("");
    const body = messageBody(bscBlankPlainWithAttachment.payload);
    expect(body).toContain("NOTIFICACIÓN DE consumo");
    expect(body).toContain("Monto: RD$ 394.00");
    expect(body).toContain("Fecha y hora: 6/10/2026 23:18:05");
  });

  it("converts an ISO-8859-1 HTML-only message into Label: | value rows", () => {
    const body = messageBody(apapHtmlOnly.payload);
    expect(body).toContain("Detalle de la transacción");
    expect(body).toContain("Fecha: | 4/10/2026");
    expect(body).toContain("Comercio: | BURGER KING SAN ISIDRO");
    expect(body).toContain("Estado: | Transacción Aprobada");
    expect(body).not.toMatch(/<|&[a-z]+;|\|\s*\|/i);
  });

  it("returns an empty body when there is no text part", () => {
    const pdfOnly: GmailMessagePart = {
      mimeType: "multipart/mixed",
      parts: [{ mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "x" } }],
    };
    expect(messageBody(pdfOnly)).toBe("");
    expect(messageBody(undefined)).toBe("");
  });

  it("lists only text parts whose data must be fetched as an attachment", () => {
    expect(partsNeedingAttachment(bscBlankPlainWithAttachment.payload)).toEqual([]);
    const big: GmailMessagePart = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { attachmentId: "big-plain" } },
        { mimeType: "text/html", body: { data: b64url("<p>x</p>") } },
      ],
    };
    expect(partsNeedingAttachment(big).map((p) => p.body?.attachmentId)).toEqual(["big-plain"]);
  });
});

describe("toRawEmail", () => {
  it("maps headers, receive time, snippet and body", () => {
    expect(toRawEmail(scotiabankAlternative)).toEqual({
      id: "18f2a0c3d4e5f601",
      threadId: "18f2a0c3d4e5f601",
      from: "Scotiabank <alertas@scotiabank.com>",
      subject: "Uso de tarjeta de crédito",
      date: "2026-10-04T23:35:41.000Z",
      snippet: "Hola SATORU, Se realizó una autorización por un monto de $5,986.90 DOP",
      body: expect.stringContaining("***7341 a las 07:35 pm AST"),
    });
  });

  it("falls back to the Date header, then to an empty date", () => {
    const noInternal = { ...scotiabankAlternative, internalDate: undefined };
    expect(toRawEmail(noInternal).date).toBe("2026-10-04T23:35:40.000Z");
    const noDate = { ...noInternal, payload: { ...noInternal.payload, headers: [] } };
    expect(toRawEmail(noDate).date).toBe("");
  });

  it("produces emails the bank parsers read (one per MIME shape)", () => {
    expect(parseEmail(toRawEmail(scotiabankAlternative))).toMatchObject({
      gmailMessageId: "18f2a0c3d4e5f601",
      bank: "Scotiabank",
      date: "2026-10-04T19:35:00-04:00",
      cardLast4: "7341",
      amount: 5986.9,
      currency: "DOP",
      merchant: "SUPERM. NACIONAL MAXIM",
    });
    expect(parseEmail(toRawEmail(apapHtmlOnly))).toMatchObject({
      gmailMessageId: "18f2a1b2c3d4e5f6",
      bank: "APAP",
      date: "2026-10-04T20:07:00-04:00",
      cardLast4: "5977",
      amount: 920,
      currency: "DOP",
      merchant: "BURGER KING SAN ISIDRO",
    });
    expect(parseEmail(toRawEmail(bscBlankPlainWithAttachment))).toMatchObject({
      gmailMessageId: "18f2b0000000aa01",
      bank: "Banco Santa Cruz",
      date: "2026-10-06T23:18:05-04:00",
      cardLast4: "9236",
      amount: 394,
      currency: "DOP",
      merchant: "SM BRAVO LAS AMERICAS SANTO DOMINGODO",
    });
  });
});
