import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getUserRole } from "@/lib/platform/permissions";
import { sql, str } from "@/lib/platform/db";
import { PLATFORM_SCHEMAS } from "@/lib/platform/data-dictionary";

/**
 * Data explorer (Settings → Data Explorer) — ADMIN-ONLY, READ-ONLY.
 *
 * IMPORTANT: every code path in this file runs SELECT statements
 * ONLY. There are no INSERT / UPDATE / DELETE / DDL statements here
 * and there must never be — this endpoint exists so an admin can
 * look at the data, never change it.
 *
 * ?mode=tables → the allowlist (schemas + tables from
 * information_schema, platform schemas only).
 * ?mode=rows&schema=&table=&page= → 25 rows of the allowlisted
 * table. bytea columns and known large text columns are EXCLUDED
 * entirely; remaining long text values are truncated server-side to
 * 240 chars. Schema/table are validated against the allowlist
 * before any query is built (400 otherwise), and identifiers are
 * double-quoted from the allowlisted names.
 */

const PAGE_SIZE = 25;
const TRUNCATE_AT = 240;
/** Column names whose values are large payloads — excluded by name,
 * in addition to every bytea column. */
const EXCLUDED_COLUMN_NAMES = new Set([
  "content",
  "text",
  "body",
  "xml",
  "payload",
  "extracted_text",
  "search_vector",
]);

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

async function requireAdmin() {
  const user = getSessionUser();
  if (!user) return { error: 401 as const };
  await ensurePlatform();
  const role = await getUserRole(user.email);
  if (role !== "admin") return { error: 403 as const };
  return { user };
}

interface Allowlist {
  schemas: { schema: string; tables: string[] }[];
  tableSet: Set<string>; // "schema.table"
}

async function getAllowlist(): Promise<Allowlist> {
  const db = sql();
  // SELECT only.
  const rows = await db`
    SELECT DISTINCT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema <> 'pg_catalog' AND table_schema <> 'information_schema'
    ORDER BY table_schema, table_name`;
  const allow = new Set<string>(PLATFORM_SCHEMAS);
  const bySchema = new Map<string, string[]>();
  const tableSet = new Set<string>();
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    const schema = str(rec.table_schema);
    const table = str(rec.table_name);
    if (!allow.has(schema)) continue;
    const list = bySchema.get(schema) ?? [];
    list.push(table);
    bySchema.set(schema, list);
    tableSet.add(`${schema}.${table}`);
  }
  const schemas = PLATFORM_SCHEMAS.filter((s) => bySchema.has(s)).map(
    (s) => ({ schema: s, tables: bySchema.get(s)! })
  );
  return { schemas, tableSet };
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin();
  if ("error" in gate) {
    return NextResponse.json(
      { error: gate.error === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.error }
    );
  }

  const params = req.nextUrl.searchParams;
  const mode = params.get("mode") ?? "tables";
  const allowlist = await getAllowlist();

  if (mode === "tables") {
    return NextResponse.json({ schemas: allowlist.schemas });
  }

  if (mode !== "rows") {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }

  const schema = params.get("schema") ?? "";
  const table = params.get("table") ?? "";
  if (!allowlist.tableSet.has(`${schema}.${table}`)) {
    return NextResponse.json(
      { error: "schema/table is not in the allowlist" },
      { status: 400 }
    );
  }
  const pageRaw = Number(params.get("page") ?? 1);
  const page = isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  const db = sql();
  // SELECT only: the table's column list, used to exclude bytea and
  // large text columns before building the (SELECT-only) row query.
  const colRows = await db`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${table}
    ORDER BY ordinal_position`;
  const columns: string[] = [];
  for (const r of colRows) {
    const rec = r as Record<string, unknown>;
    const name = str(rec.column_name);
    const type = str(rec.data_type);
    if (type === "bytea") continue;
    if (EXCLUDED_COLUMN_NAMES.has(name.toLowerCase())) continue;
    columns.push(name);
  }
  if (columns.length === 0) {
    return NextResponse.json({
      schema,
      table,
      page,
      pageSize: PAGE_SIZE,
      total: 0,
      columns: [],
      rows: [],
    });
  }

  const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  const colList = columns.map(quoteIdent).join(", ");
  const offset = (page - 1) * PAGE_SIZE;

  // SELECT only (bounded count + one page of rows).
  const countRows = (await db.query(
    `SELECT COUNT(*)::int AS n FROM ${qualified}`
  )) as Record<string, unknown>[];
  const total = Number(countRows[0]?.n ?? 0);
  const rawRows = (await db.query(
    `SELECT ${colList} FROM ${qualified} LIMIT ${PAGE_SIZE} OFFSET ${offset}`
  )) as Record<string, unknown>[];

  const rows = rawRows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const col of columns) {
      let v: unknown = row[col];
      if (typeof v === "string" && v.length > TRUNCATE_AT) {
        v = v.slice(0, TRUNCATE_AT) + "…";
      } else if (v instanceof Date) {
        v = v.toISOString();
      } else if (v !== null && typeof v === "object") {
        const text = JSON.stringify(v);
        v = text.length > TRUNCATE_AT ? text.slice(0, TRUNCATE_AT) + "…" : text;
      }
      out[col] = v ?? null;
    }
    return out;
  });

  return NextResponse.json({
    schema,
    table,
    page,
    pageSize: PAGE_SIZE,
    total,
    columns,
    rows,
  });
}
