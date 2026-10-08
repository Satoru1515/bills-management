/**
 * Keyword rules that assign a category to a merchant (docs/parsing-spec.md §5).
 * Pure: no network, no database. Rules stored per user (`category_rules`) are merged
 * in front of the defaults with {@link withUserRules} and compiled with {@link createCategorizer}.
 */

import { CATEGORIES, DEFAULT_CATEGORY, type Category } from "./types";

export interface CategoryRule {
  keyword: string;
  category: Category;
}

/** Keywords per category, in evaluation order (the order of the table in the spec). */
const DEFAULT_KEYWORDS: ReadonlyArray<readonly [Category, readonly string[]]> = [
  [
    "Supermercado",
    [
      "PRICESMART",
      "JUMBO",
      "SIRENA",
      "BRAVO",
      "HIPER OLE",
      "HIPERMERCADOS OLE",
      "NACIONAL",
      "SUPERM",
    ],
  ],
  ["Combustible", ["SHELL", "ESSO", "PETRONAN", "CREDIGAS", "PROPAGAS", "ESTACION"]],
  [
    "Restaurantes",
    [
      "MC DONALDS",
      "MCDONALD",
      "BURGER KING",
      "HOT DOG",
      "LA TINAJA",
      "RESTAURANT",
      "CAFE",
      "BAR",
      "RINCON SOLEADO",
      "LA LOLA",
    ],
  ],
  ["Viajes", ["AIRBNB", "AERODOM", "TOURS", "HACIENDA", "HOTEL"]],
  ["Transporte", ["UBER", "PEAJES"]],
  ["Suscripciones", ["SPOTIFY", "CRUNCHYROLL", "APPLE.COM", "CHATGPT", "ANTHROPIC", "NETFLIX"]],
  ["Entretenimiento", ["RIOT GAMES", "EVENTOS TOI"]],
  ["Compras online", ["AMAZON", "BM CARGO", "SHEIN"]],
  ["Hogar", ["IKEA", "BELL HOME", "FERREDEPOT"]],
  ["Salud", ["FCIA", "FARMACIA"]],
  ["Telecom", ["WIND TELECOM", "CLARO", "ALTICE"]],
  ["Servicios", ["PROCURADURIA", "TRANSITO", "CORAABO", "PAGO DE FACTURA", "EDESUR", "EDEESTE"]],
  ["Cuidado personal", ["BARBER"]],
  ["Licores", ["LIQUOR"]],
];

export const DEFAULT_CATEGORY_RULES: readonly CategoryRule[] = DEFAULT_KEYWORDS.flatMap(
  ([category, keywords]) => keywords.map((keyword) => ({ keyword, category })),
);

/**
 * Keywords this short must match a whole word; longer ones only need to start a word.
 * Keeps `BAR` from matching `BARBER SHOP` or `BARCELO`, while `CAFE` still matches `CAFETERIA`.
 */
const WHOLE_WORD_MAX_LENGTH = 3;

const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);

export function isCategory(value: string): value is Category {
  return CATEGORY_SET.has(value);
}

/** Upper case, accents removed, whitespace collapsed: `Estación  Shell` → `ESTACION SHELL`. */
export function normalizeForMatch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileKeyword(keyword: string): RegExp {
  const end = keyword.length <= WHOLE_WORD_MAX_LENGTH ? "(?![\\p{L}\\p{N}])" : "";
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(keyword)}${end}`, "u");
}

export type Categorizer = (merchant: string) => Category;

/**
 * Compiles rules once. The returned function gives the category of the first rule whose
 * keyword appears in the merchant (case and accent insensitive, starting at a word boundary),
 * or `Otros` when none does. Rules with an empty keyword are skipped.
 */
export function createCategorizer(
  rules: readonly CategoryRule[] = DEFAULT_CATEGORY_RULES,
): Categorizer {
  const compiled = rules.flatMap(({ keyword, category }) => {
    const normalized = normalizeForMatch(keyword);
    return normalized ? [{ re: compileKeyword(normalized), category }] : [];
  });
  return (merchant) => {
    const text = normalizeForMatch(merchant);
    return compiled.find(({ re }) => re.test(text))?.category ?? DEFAULT_CATEGORY;
  };
}

/** Categorizes with the default rules from the spec. */
export const categorize: Categorizer = createCategorizer();

/** A rule as stored in the database: the category is unchecked text. */
export interface StoredCategoryRule {
  keyword: string;
  category: string;
}

/**
 * Puts the user's own rules (e.g. rows of `category_rules`) in front of the base rules, so they
 * win over the defaults. Rows with an unknown category or a blank keyword are dropped.
 */
export function withUserRules(
  userRules: readonly StoredCategoryRule[],
  base: readonly CategoryRule[] = DEFAULT_CATEGORY_RULES,
): CategoryRule[] {
  const valid = userRules.flatMap(({ keyword, category }): CategoryRule[] =>
    keyword.trim() && isCategory(category) ? [{ keyword: keyword.trim(), category }] : [],
  );
  return [...valid, ...base];
}
