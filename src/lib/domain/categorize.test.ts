import { describe, expect, it } from "vitest";
import * as apap from "../parsers/__fixtures__/apap";
import * as bsc from "../parsers/__fixtures__/bsc";
import * as paypal from "../parsers/__fixtures__/paypal";
import * as scotiabank from "../parsers/__fixtures__/scotiabank";
import { parseEmail } from "../parsers";
import {
  DEFAULT_CATEGORY_RULES,
  categorize,
  createCategorizer,
  isCategory,
  normalizeForMatch,
  withUserRules,
} from "./categorize";
import { CATEGORIES, DEFAULT_CATEGORY } from "./types";

describe("DEFAULT_CATEGORY_RULES", () => {
  it("follows the spec table order and only uses known categories", () => {
    const order = [...new Set(DEFAULT_CATEGORY_RULES.map((rule) => rule.category))];
    expect(order).toEqual(CATEGORIES.filter((category) => category !== DEFAULT_CATEGORY));
  });

  it("has no duplicate keywords", () => {
    const keywords = DEFAULT_CATEGORY_RULES.map((rule) => rule.keyword);
    expect(new Set(keywords).size).toBe(keywords.length);
  });

  it("matches every keyword to its own category", () => {
    for (const { keyword, category } of DEFAULT_CATEGORY_RULES) {
      expect(categorize(`${keyword} SANTO DOMINGO`), keyword).toBe(category);
    }
  });
});

describe("categorize", () => {
  it.each([
    ["SUPERM. NACIONAL MAXIM", "Supermercado"],
    ["SM BRAVO LAS AMERICAS SANTO DOMINGODO", "Supermercado"],
    ["PRICESMART SANTO DOMINGO", "Supermercado"],
    ["HIPERMERCADOS OLE DUARTE", "Supermercado"],
    ["ESTACION SHELL LOS PRADOS", "Combustible"],
    ["Estación de servicio Texaco", "Combustible"],
    ["BURGER KING SAN ISIDRO", "Restaurantes"],
    ["MCDONALDS CHURCHILL", "Restaurantes"],
    ["CAFETERIA EL CONDE", "Restaurantes"],
    ["SPORTS BAR & GRILL", "Restaurantes"],
    ["AIRBNB * HM4XYZ", "Viajes"],
    ["HOTELES CATALONIA", "Viajes"],
    ["UBER *TRIP", "Transporte"],
    ["DLOCAL*UBER RIDES", "Transporte"],
    ["Spotify AB", "Suscripciones"],
    ["APPLE.COM/BILL", "Suscripciones"],
    ["Crunchyroll LLC", "Suscripciones"],
    ["RIOT GAMES", "Entretenimiento"],
    ["AMAZON MKTPL*ZK4LP0", "Compras online"],
    ["SHEIN.COM", "Compras online"],
    ["IKEA SANTO DOMINGO", "Hogar"],
    ["FCIA CAROL", "Salud"],
    ["FARMACIAS LOS HIDALGOS", "Salud"],
    ["CLARO DOMINICANA", "Telecom"],
    ["PAGO DE FACTURA", "Servicios"],
    ["EDESUR DOMINICANA", "Servicios"],
    ["BARBER SHOP EL PRIMO", "Cuidado personal"],
    ["THE LIQUOR STORE", "Licores"],
  ])("puts %j in %s", (merchant, category) => {
    expect(categorize(merchant)).toBe(category);
  });

  it("is case, accent and whitespace insensitive", () => {
    expect(categorize("  burger   king  ")).toBe("Restaurantes");
    expect(categorize("procuraduría general")).toBe("Servicios");
    expect(categorize("Tránsito Terrestre")).toBe("Servicios");
  });

  it("uses the first matching rule in table order", () => {
    // Supermercado (NACIONAL) is evaluated before Restaurantes (CAFE).
    expect(categorize("CAFE NACIONAL")).toBe("Supermercado");
    // Viajes (HOTEL) before Compras online (AMAZON).
    expect(categorize("HOTEL AMAZONAS")).toBe("Viajes");
  });

  it("only matches keywords at the start of a word", () => {
    expect(categorize("ESPRESSO LAB")).toBe(DEFAULT_CATEGORY);
    expect(categorize("MEGAJUMBO")).toBe(DEFAULT_CATEGORY);
  });

  it("matches the short keyword BAR only as a whole word", () => {
    expect(categorize("BAR LA ESQUINA")).toBe("Restaurantes");
    expect(categorize("BARCELO BAVARO")).toBe(DEFAULT_CATEGORY);
    expect(categorize("BARBERSHOP")).toBe("Cuidado personal");
  });

  it.each(["", "   ", "STEAM GAMES", "HUMBLE BUNDLE", "TIENDA LA 30"])(
    "falls back to Otros for %j",
    (merchant) => {
      expect(categorize(merchant)).toBe(DEFAULT_CATEGORY);
    },
  );
});

describe("categorize on parsed fixtures", () => {
  it.each([
    ["Scotiabank", scotiabank.creditCardUse, "Supermercado"],
    ["APAP", apap.contactless, "Restaurantes"],
    ["Banco Santa Cruz", bsc.consumption, "Supermercado"],
    ["PayPal", paypal.spotify, "Suscripciones"],
  ] as const)("categorizes the %s fixture", (_bank, email, category) => {
    const parsed = parseEmail(email);
    expect(parsed).not.toBeNull();
    expect(categorize(parsed!.merchant)).toBe(category);
  });
});

describe("createCategorizer", () => {
  it("uses only the rules it is given", () => {
    const custom = createCategorizer([{ keyword: "colmado", category: "Supermercado" }]);
    expect(custom("COLMADO DON JUAN")).toBe("Supermercado");
    expect(custom("BURGER KING")).toBe(DEFAULT_CATEGORY);
  });

  it("skips rules with a blank keyword", () => {
    const custom = createCategorizer([
      { keyword: "  ", category: "Hogar" },
      { keyword: "", category: "Hogar" },
    ]);
    expect(custom("ANYTHING")).toBe(DEFAULT_CATEGORY);
  });

  it("treats regex characters in keywords literally", () => {
    const custom = createCategorizer([{ keyword: "A+B (SRL)", category: "Hogar" }]);
    expect(custom("A+B (SRL) PIANTINI")).toBe("Hogar");
    expect(custom("AAB SRL")).toBe(DEFAULT_CATEGORY);
  });
});

describe("withUserRules", () => {
  it("puts user rules before the defaults so they win", () => {
    const rules = withUserRules([{ keyword: "Burger King", category: "Entretenimiento" }]);
    expect(createCategorizer(rules)("BURGER KING SAN ISIDRO")).toBe("Entretenimiento");
    expect(createCategorizer(rules)("SPOTIFY")).toBe("Suscripciones");
    expect(rules).toHaveLength(DEFAULT_CATEGORY_RULES.length + 1);
  });

  it("drops rows with an unknown category or a blank keyword and trims keywords", () => {
    const rules = withUserRules(
      [
        { keyword: "  colmado  ", category: "Supermercado" },
        { keyword: "gym", category: "Gimnasio" },
        { keyword: "   ", category: "Hogar" },
      ],
      [],
    );
    expect(rules).toEqual([{ keyword: "colmado", category: "Supermercado" }]);
  });
});

describe("helpers", () => {
  it("normalizeForMatch folds case, accents and spaces", () => {
    expect(normalizeForMatch("  Estación  Shell\n")).toBe("ESTACION SHELL");
  });

  it("isCategory accepts only known categories", () => {
    expect(isCategory("Otros")).toBe(true);
    expect(isCategory("Supermercado")).toBe(true);
    expect(isCategory("supermercado")).toBe(false);
    expect(isCategory("Gimnasio")).toBe(false);
  });
});
