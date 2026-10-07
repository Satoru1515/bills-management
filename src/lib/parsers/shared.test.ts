import { describe, expect, it } from "vitest";
import {
  CARD_ENDING_RE,
  combineReceivedDateWithTime,
  formatDrIso,
  isApprovedStatus,
  monthOf,
  normalizeText,
  parse24HourTime,
  parseAmount,
  parseAmountWithPrefix,
  parseDayMonthYear,
  readField,
  to24Hour,
  toDrParts,
  toPlainLines,
} from "./shared";

describe("normalizeText", () => {
  it("collapses line breaks, tabs and non-breaking spaces", () => {
    expect(normalizeText("  terminada\n en \t9236 \r\n")).toBe("terminada en 9236");
  });
});

describe("parseAmount", () => {
  it.each([
    ["5,986.90", 5986.9],
    ["920.00", 920],
    ["1,234,567.5", 1234567.5],
    ["394", 394],
  ])("parses %s", (text, expected) => {
    expect(parseAmount(text)).toBe(expected);
  });

  it.each(["", "abc", "12.345", "-5.00"])("rejects %j", (text) => {
    expect(parseAmount(text)).toBeNull();
  });
});

describe("to24Hour", () => {
  it.each([
    ["07:35", "pm", 19, 35],
    ["12:59", "pm", 12, 59],
    ["12:05", "am", 0, 5],
    ["9:00", "AM", 9, 0],
  ])("converts %s %s", (time, meridiem, hour, minute) => {
    expect(to24Hour(time, meridiem)).toEqual({ hour, minute });
  });

  it.each([
    ["13:00", "pm"],
    ["0:30", "am"],
    ["7:60", "am"],
    ["7.30", "am"],
  ])("rejects %s %s", (time, meridiem) => {
    expect(to24Hour(time, meridiem)).toBeNull();
  });
});

describe("Dominican Republic dates", () => {
  it("formats date parts with the -04:00 offset", () => {
    const iso = formatDrIso({ year: 2026, month: 3, day: 7, hour: 8, minute: 5, second: 9 });
    expect(iso).toBe("2026-03-07T08:05:09-04:00");
    expect(monthOf(iso)).toBe("2026-03");
  });

  it("converts a UTC timestamp to local parts across midnight", () => {
    expect(toDrParts("2026-10-01T02:30:00Z")).toEqual({
      year: 2026,
      month: 9,
      day: 30,
      hour: 22,
      minute: 30,
      second: 0,
    });
  });

  it("returns null for an invalid timestamp", () => {
    expect(toDrParts("yesterday")).toBeNull();
  });
});

describe("combineReceivedDateWithTime", () => {
  it("keeps the receive day when the stated time is earlier", () => {
    expect(combineReceivedDateWithTime("2026-10-04T23:35:41Z", 19, 35)).toBe(
      "2026-10-04T19:35:00-04:00",
    );
  });

  it("tolerates a stated time a few minutes after reception", () => {
    expect(combineReceivedDateWithTime("2026-10-04T23:35:00Z", 19, 40)).toBe(
      "2026-10-04T19:40:00-04:00",
    );
  });

  it("moves to the previous day (and month) when the time is after reception", () => {
    expect(combineReceivedDateWithTime("2026-11-01T04:01:00Z", 23, 58)).toBe(
      "2026-10-31T23:58:00-04:00",
    );
  });

  it("returns null for an invalid receive date", () => {
    expect(combineReceivedDateWithTime("", 10, 0)).toBeNull();
  });
});

describe("parseDayMonthYear", () => {
  it.each([
    ["4/10/2026", { year: 2026, month: 10, day: 4 }],
    ["06/10/2026", { year: 2026, month: 10, day: 6 }],
    [" 31/12/2025 ", { year: 2025, month: 12, day: 31 }],
    ["29/2/2028", { year: 2028, month: 2, day: 29 }],
  ])("parses %j", (text, expected) => {
    expect(parseDayMonthYear(text)).toEqual(expected);
  });

  it.each(["", "2026-10-04", "10/4/26", "31/9/2026", "29/2/2026", "0/10/2026", "4/13/2026"])(
    "rejects %j",
    (text) => {
      expect(parseDayMonthYear(text)).toBeNull();
    },
  );
});

describe("parse24HourTime", () => {
  it.each([
    ["20:7", { hour: 20, minute: 7, second: 0 }],
    ["9:05", { hour: 9, minute: 5, second: 0 }],
    ["0:0", { hour: 0, minute: 0, second: 0 }],
    ["23:18:05", { hour: 23, minute: 18, second: 5 }],
  ])("parses %j", (text, expected) => {
    expect(parse24HourTime(text)).toEqual(expected);
  });

  it.each(["", "24:00", "12:60", "12:30:60", "7 pm", "12"])("rejects %j", (text) => {
    expect(parse24HourTime(text)).toBeNull();
  });
});

describe("toPlainLines", () => {
  it("normalizes CRLF and non-breaking spaces but keeps the lines", () => {
    expect(toPlainLines("Monto:\u00a0RD$ 5\r\nEstado: Aprobada\r")).toBe(
      "Monto: RD$ 5\nEstado: Aprobada\n",
    );
  });
});

describe("readField", () => {
  const labels = ["Fecha", "Monto", "Comercio", "Estado", "Lugar de transacci[óo]n"];

  it.each([
    ["Fecha: | 4/10/2026\nMonto: | 920.00", "Fecha", "4/10/2026"],
    ["| Comercio: | BURGER   KING | \n", "Comercio", "BURGER KING"],
    ["Comercio:\nFARMACIA CAROL\nEstado:\nAprobada", "Comercio", "FARMACIA CAROL"],
    ["Lugar de transaccion: SM BRAVO  \n", "Lugar de transacci[óo]n", "SM BRAVO"],
    ["monto: RD$ 394.00", "Monto", "RD$ 394.00"],
  ])("reads %j", (body, label, expected) => {
    expect(readField(body, label, labels)).toBe(expected);
  });

  it("does not match a label inside another word", () => {
    expect(readField("Subfecha: 1/1/2026", "Fecha", labels)).toBeNull();
  });

  it("returns null for an empty cell instead of the next label", () => {
    expect(readField("Comercio: |\nEstado: | Aprobada", "Comercio", labels)).toBeNull();
  });

  it("returns null when the label is missing", () => {
    expect(readField("Estado: Aprobada", "Comercio", labels)).toBeNull();
  });
});

describe("parseAmountWithPrefix", () => {
  it.each([
    ["RD$ 394.00", 394],
    ["US$1,045.50", 1045.5],
    ["$ 11.99", 11.99],
    ["920.00", 920],
  ])("parses %j", (text, expected) => {
    expect(parseAmountWithPrefix(text)).toBe(expected);
  });

  it.each(["", "RD$", "EUR 5.00", "RD$ N/D"])("rejects %j", (text) => {
    expect(parseAmountWithPrefix(text)).toBeNull();
  });
});

describe("CARD_ENDING_RE", () => {
  it.each([
    ["Visa Platinum terminada en 5977 presenta", "5977"],
    ["Crédito Gold terminada en ****9236", "9236"],
    ["TERMINADA EN XXXX1842.", "1842"],
  ])("finds the card in %j", (text, expected) => {
    expect(CARD_ENDING_RE.exec(text)?.[1]).toBe(expected);
  });

  it("ignores longer numbers", () => {
    expect(CARD_ENDING_RE.exec("terminada en 123456")).toBeNull();
  });
});

describe("isApprovedStatus", () => {
  it.each([
    ["Aprobada", true],
    ["Transacción Aprobada", true],
    ["Transacción No Aprobada", false],
    ["Rechazada", false],
    ["Aplicada", false],
  ])("%j → %s", (status, expected) => {
    expect(isApprovedStatus(status)).toBe(expected);
  });
});
