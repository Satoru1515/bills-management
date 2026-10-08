// @vitest-environment node
/**
 * database.types.ts follows the output of `npm run db:types` (supabase gen
 * types). This test reads it with the TypeScript parser and checks it against
 * the schema the migrations build, so a migration without regenerated types
 * fails here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDb } from "@/test/pglite";

interface DbColumn {
  table_name: string;
  column_name: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
}

/** Members of an object type literal: name -> { optional, type text }. */
type Members = Map<string, { optional: boolean; type: string }>;

interface TableTypes {
  Row: Members;
  Insert: Members;
  Update: Members;
  foreignKeys: string[];
}

const TS_TYPE_BY_UDT: Record<string, string> = {
  uuid: "string",
  text: "string",
  timestamptz: "string",
  numeric: "number",
  int4: "number",
  bool: "boolean",
  jsonb: "Json",
};

const FILE = join(process.cwd(), "src", "lib", "supabase", "database.types.ts");
const source = ts.createSourceFile(FILE, readFileSync(FILE, "utf8"), ts.ScriptTarget.Latest, true);

function typeLiteralMember(node: ts.TypeNode | undefined, name: string): ts.TypeNode | undefined {
  if (!node || !ts.isTypeLiteralNode(node)) return undefined;
  for (const member of node.members) {
    if (ts.isPropertySignature(member) && member.name.getText(source) === name) {
      return member.type;
    }
  }
  return undefined;
}

function membersOf(node: ts.TypeNode | undefined): Members {
  const result: Members = new Map();
  if (!node || !ts.isTypeLiteralNode(node)) return result;
  for (const member of node.members) {
    if (ts.isPropertySignature(member) && member.type) {
      result.set(member.name.getText(source), {
        optional: member.questionToken !== undefined,
        type: member.type.getText(source).replace(/\s+/g, " "),
      });
    }
  }
  return result;
}

function readTableTypes(): Map<string, TableTypes> {
  const alias = source.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === "Database",
  );
  const tables = typeLiteralMember(typeLiteralMember(alias?.type, "public"), "Tables");
  const result = new Map<string, TableTypes>();
  if (!tables || !ts.isTypeLiteralNode(tables)) return result;
  for (const member of tables.members) {
    if (!ts.isPropertySignature(member)) continue;
    const relationships = typeLiteralMember(member.type, "Relationships");
    const foreignKeys =
      relationships && ts.isTupleTypeNode(relationships)
        ? relationships.elements.map((element) =>
            JSON.parse(
              typeLiteralMember(element as ts.TypeNode, "foreignKeyName")?.getText(source) ?? '""',
            ),
          )
        : [];
    result.set(member.name.getText(source), {
      Row: membersOf(typeLiteralMember(member.type, "Row")),
      Insert: membersOf(typeLiteralMember(member.type, "Insert")),
      Update: membersOf(typeLiteralMember(member.type, "Update")),
      foreignKeys: foreignKeys.sort(),
    });
  }
  return result;
}

let db: PGlite;
let columns: DbColumn[];
const types = readTableTypes();

beforeAll(async () => {
  db = await createMigratedDb();
  const result = await db.query<DbColumn>(
    `select table_name, column_name, udt_name, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public'
      order by table_name, column_name`,
  );
  columns = result.rows;
});

afterAll(async () => {
  await db.close();
});

function columnsOf(table: string): DbColumn[] {
  return columns.filter((column) => column.table_name === table);
}

describe("database.types.ts", () => {
  it("lists exactly the tables in the public schema", async () => {
    const result = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
    );
    expect([...types.keys()].sort()).toEqual(result.rows.map((row) => row.table_name));
  });

  it("has the same columns in Row, Insert and Update as the database", () => {
    for (const [table, tableTypes] of types) {
      const expected = columnsOf(table).map((column) => column.column_name);
      expect([...tableTypes.Row.keys()].sort(), `${table}.Row`).toEqual(expected);
      expect([...tableTypes.Insert.keys()].sort(), `${table}.Insert`).toEqual(expected);
      expect([...tableTypes.Update.keys()].sort(), `${table}.Update`).toEqual(expected);
    }
  });

  it("maps each column type and nullability", () => {
    for (const [table, tableTypes] of types) {
      for (const column of columnsOf(table)) {
        const base = TS_TYPE_BY_UDT[column.udt_name];
        expect(base, `unmapped type ${column.udt_name}`).toBeDefined();
        const expected = column.is_nullable === "YES" ? `${base} | null` : base;
        const name = `${table}.${column.column_name}`;
        expect(tableTypes.Row.get(column.column_name), name).toEqual({
          optional: false,
          type: expected,
        });
        expect(tableTypes.Insert.get(column.column_name)?.type, name).toBe(expected);
        expect(tableTypes.Update.get(column.column_name), name).toEqual({
          optional: true,
          type: expected,
        });
      }
    }
  });

  it("makes an Insert field optional only when the column is nullable or has a default", () => {
    for (const [table, tableTypes] of types) {
      for (const column of columnsOf(table)) {
        const optional = column.is_nullable === "YES" || column.column_default !== null;
        expect(
          tableTypes.Insert.get(column.column_name)?.optional,
          `${table}.${column.column_name}`,
        ).toBe(optional);
      }
    }
  });

  it("declares every foreign key between public tables", async () => {
    const result = await db.query<{ table_name: string; constraint_name: string }>(
      `select c.conrelid::regclass::text as table_name, c.conname as constraint_name
         from pg_constraint c
         join pg_class target on target.oid = c.confrelid
         join pg_namespace ns on ns.oid = target.relnamespace
        where c.contype = 'f' and ns.nspname = 'public'
        order by 1, 2`,
    );
    for (const [table, tableTypes] of types) {
      const expected = result.rows
        .filter((row) => row.table_name.replace(/^public\./, "") === table)
        .map((row) => row.constraint_name);
      expect(tableTypes.foreignKeys, table).toEqual(expected);
    }
  });
});
