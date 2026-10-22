"use client";

/**
 * Settings → Data Dictionary: searchable, grouped by schema, with
 * expandable tables showing columns (name, type, nullable) and the
 * curated plain-language description where one exists. Data from
 * GET /api/platform/settings/data-dictionary (admin/internal).
 */

import { useEffect, useMemo, useState } from "react";
import PageHero from "@/components/PageHero";
import SettingsNav from "@/components/settings/SettingsNav";

interface DictColumn {
  name: string;
  type: string;
  nullable: boolean;
}
interface DictTable {
  table: string;
  description: string;
  columns: DictColumn[];
}
interface DictSchema {
  schema: string;
  tables: DictTable[];
}

export default function SettingsDataDictionaryPage() {
  const [schemas, setSchemas] = useState<DictSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/platform/settings/data-dictionary")
      .then(async (r) => {
        if (r.status === 403) {
          setError("Your role cannot view the data dictionary.");
          return null;
        }
        if (!r.ok) {
          setError("Could not load the data dictionary.");
          return null;
        }
        return (await r.json()) as { schemas?: DictSchema[] };
      })
      .then((d) => {
        if (d?.schemas) setSchemas(d.schemas);
      })
      .catch(() => setError("Could not load the data dictionary."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return schemas;
    return schemas
      .map((s) => ({
        ...s,
        tables: s.tables.filter(
          (t) =>
            t.table.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.columns.some((c) => c.name.toLowerCase().includes(q))
        ),
      }))
      .filter((s) => s.tables.length > 0);
  }, [schemas, query]);

  const toggle = (key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Data Dictionary"
        subtitle="Every platform schema, table, and column — and what the core entities mean"
      />
      <SettingsNav />
      <main className="mx-auto max-w-[900px] px-4 py-6 sm:px-6">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tables, columns, descriptions…"
          aria-label="Search the data dictionary"
          className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8] dark:placeholder:text-white/30"
        />

        {loading ? (
          <div className="mt-6 space-y-3" aria-busy="true">
            <div className="skel h-12" />
            <div className="skel h-12" />
            <div className="skel h-12" />
            <span className="sr-only">Loading data dictionary…</span>
          </div>
        ) : error ? (
          <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
            {error}
          </p>
        ) : filtered.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500 dark:text-white/50">
            No tables match “{query}”.
          </p>
        ) : (
          filtered.map((s) => (
            <section key={s.schema} className="mt-8">
              <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
                {s.schema}
                <span className="ml-2 align-middle text-xs font-normal text-slate-400 dark:text-white/40">
                  {s.tables.length} tables
                </span>
              </h2>
              <div className="mt-3 flex flex-col gap-2">
                {s.tables.map((t) => {
                  const key = `${s.schema}.${t.table}`;
                  const isOpen = open.has(key) || query.trim().length > 0;
                  return (
                    <div
                      key={key}
                      className="rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#132847]/60"
                    >
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        aria-expanded={isOpen}
                        className="flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-left"
                      >
                        <span className="font-mono text-sm font-semibold text-[#0d1f3c] dark:text-white">
                          {t.table}
                        </span>
                        <span className="text-xs text-slate-400 dark:text-white/40">
                          {t.columns.length} columns
                        </span>
                        <span
                          aria-hidden
                          className={`ml-auto text-slate-400 transition-transform dark:text-white/40 ${isOpen ? "rotate-180" : ""}`}
                        >
                          ▾
                        </span>
                      </button>
                      {t.description && (
                        <p className="px-4 pb-3 text-sm leading-relaxed text-slate-500 dark:text-white/60">
                          {t.description}
                        </p>
                      )}
                      {isOpen && (
                        <div className="overflow-x-auto border-t border-slate-100 px-4 py-3 dark:border-white/10">
                          <table className="w-full min-w-[480px] text-left text-sm">
                            <thead>
                              <tr className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/40">
                                <th className="py-1.5 pr-3 font-semibold">Column</th>
                                <th className="py-1.5 pr-3 font-semibold">Type</th>
                                <th className="py-1.5 font-semibold">Nullable</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                              {t.columns.map((c) => (
                                <tr key={c.name}>
                                  <td className="py-1.5 pr-3 font-mono text-[13px] text-[#0d1f3c] dark:text-white">
                                    {c.name}
                                  </td>
                                  <td className="py-1.5 pr-3 text-slate-500 dark:text-white/60">
                                    {c.type}
                                  </td>
                                  <td className="py-1.5 text-slate-500 dark:text-white/60">
                                    {c.nullable ? "yes" : "no"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
