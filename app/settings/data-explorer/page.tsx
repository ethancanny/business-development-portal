"use client";

/**
 * Settings → Data Explorer (admin-only, read-only): schema/table
 * pickers over the allowlist from GET
 * /api/platform/settings/data-explorer?mode=tables, and a paginated
 * 25-row grid from ?mode=rows. There is deliberately NO write UI
 * anywhere on this page — the API is SELECT-only.
 */

import { useCallback, useEffect, useState } from "react";
import PageHero from "@/components/PageHero";
import SettingsNav from "@/components/settings/SettingsNav";

interface SchemaTables {
  schema: string;
  tables: string[];
}

interface RowsPayload {
  schema: string;
  table: string;
  page: number;
  pageSize: number;
  total: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

const selectCls =
  "min-h-[44px] rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8]";

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export default function SettingsDataExplorerPage() {
  const [schemas, setSchemas] = useState<SchemaTables[]>([]);
  const [schema, setSchema] = useState("");
  const [table, setTable] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RowsPayload | null>(null);
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/platform/settings/data-explorer?mode=tables")
      .then(async (r) => {
        if (r.status === 403) {
          setError("Admins only — your role cannot use the data explorer.");
          return null;
        }
        if (!r.ok) {
          setError("Could not load the table list.");
          return null;
        }
        return (await r.json()) as { schemas?: SchemaTables[] };
      })
      .then((d) => {
        if (d?.schemas) setSchemas(d.schemas);
      })
      .catch(() => setError("Could not load the table list."))
      .finally(() => setLoadingTables(false));
  }, []);

  const loadRows = useCallback(async (s: string, t: string, p: number) => {
    if (!s || !t) return;
    setLoadingRows(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        mode: "rows",
        schema: s,
        table: t,
        page: String(p),
      });
      const res = await fetch(`/api/platform/settings/data-explorer?${qs}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || "Could not load rows.");
        setData(null);
        return;
      }
      setData((await res.json()) as RowsPayload);
    } catch {
      setError("Could not load rows.");
    } finally {
      setLoadingRows(false);
    }
  }, []);

  const pickSchema = (s: string) => {
    setSchema(s);
    setTable("");
    setData(null);
    setPage(1);
  };

  const pickTable = (t: string) => {
    setTable(t);
    setPage(1);
    void loadRows(schema, t, 1);
  };

  const gotoPage = (p: number) => {
    setPage(p);
    void loadRows(schema, table, p);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const tablesForSchema = schemas.find((s) => s.schema === schema)?.tables ?? [];

  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Data Explorer"
        subtitle="A read-only look at the platform's tables, 25 rows at a time"
      />
      <SettingsNav />
      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <p className="rounded-lg border border-[#b8975a]/40 bg-[#b8975a]/10 px-3 py-2 text-sm font-medium text-[#8a6f3c] dark:text-[#d4b37a]">
          Read-only — no edits are possible here.
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40">
            Schema
            <select
              value={schema}
              onChange={(e) => pickSchema(e.target.value)}
              disabled={loadingTables}
              className={selectCls}
            >
              <option value="">Select a schema…</option>
              {schemas.map((s) => (
                <option key={s.schema} value={s.schema}>
                  {s.schema}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40">
            Table
            <select
              value={table}
              onChange={(e) => pickTable(e.target.value)}
              disabled={!schema}
              className={selectCls}
            >
              <option value="">Select a table…</option>
              {tablesForSchema.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {data && (
            <p className="pb-2 text-sm text-slate-500 dark:text-white/50">
              {data.total} rows total · page {data.page} of {totalPages}
            </p>
          )}
        </div>

        {loadingRows ? (
          <div className="mt-6 space-y-3" aria-busy="true">
            <div className="skel h-10" />
            <div className="skel h-10" />
            <div className="skel h-10" />
            <span className="sr-only">Loading rows…</span>
          </div>
        ) : data ? (
          <>
            <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#132847]/60">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-[#0d1f3c] text-[#e8dfc8] dark:border-white/10">
                    {data.columns.map((c) => (
                      <th key={c} className="whitespace-nowrap px-3 py-2.5 font-mono font-semibold">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {data.rows.map((row, i) => (
                    <tr key={i} className="transition hover:bg-[#f0f4fa] dark:hover:bg-white/5">
                      {data.columns.map((c) => (
                        <td
                          key={c}
                          className="max-w-[260px] truncate whitespace-nowrap px-3 py-2 text-slate-600 dark:text-white/70"
                          title={cellText(row[c])}
                        >
                          {cellText(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={Math.max(1, data.columns.length)}
                        className="px-3 py-8 text-center text-sm text-slate-400 dark:text-white/40"
                      >
                        This table is empty.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || loadingRows}
                onClick={() => gotoPage(page - 1)}
                className="btn btn-secondary btn-sm min-h-[44px] disabled:opacity-40"
              >
                ← Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages || loadingRows}
                onClick={() => gotoPage(page + 1)}
                className="btn btn-secondary btn-sm min-h-[44px] disabled:opacity-40"
              >
                Next →
              </button>
              <span className="text-sm text-slate-500 dark:text-white/50">
                Page {page} of {totalPages}
              </span>
            </div>
          </>
        ) : (
          !error && (
            <p className="mt-6 text-sm text-slate-500 dark:text-white/50">
              Pick a schema and a table to browse its rows.
            </p>
          )
        )}
      </main>
    </div>
  );
}
