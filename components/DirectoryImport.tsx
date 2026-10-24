"use client";

/**
 * Directory CSV import (Phase 2, Oct 21, 2026).
 *
 * Client-side CSV parse (quoted commas / escaped quotes handled),
 * a column-mapping step (each CSV column → a directory target field),
 * a 5-row mapped preview, then POST /api/platform/directory/import.
 * Duplicate handling is the server's job — its response (created /
 * duplicates / errors) is shown verbatim.
 */

import { useState } from "react";
import type { DirectoryKind } from "@/components/DirectoryUnified";

export const IMPORT_TARGET_FIELDS: { id: string; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "title", label: "Title" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "organizationName", label: "Organization" },
  { id: "website", label: "Website" },
  { id: "notes", label: "Notes" },
  { id: "type", label: "Type" },
];

/** Minimal CSV parser: handles quoted fields, "" escapes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

function guessTarget(header: string): string {
  const h = header.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (h === "name" || h === "fullname" || h === "contact" || h === "company" || h === "organization" || h === "org") {
    // "company"/"organization" as a *column header* on a people import is
    // ambiguous; name is the safer default only for person-ish headers.
    if (h === "company" || h === "organization" || h === "org") return "organizationName";
    return "name";
  }
  if (h.indexOf("title") >= 0 || h.indexOf("role") >= 0) return "title";
  if (h.indexOf("email") >= 0 || h.indexOf("mail") >= 0) return "email";
  if (h.indexOf("phone") >= 0 || h.indexOf("tel") >= 0) return "phone";
  if (h.indexOf("organization") >= 0 || h.indexOf("firm") >= 0 || h.indexOf("company") >= 0)
    return "organizationName";
  if (h.indexOf("website") >= 0 || h.indexOf("url") >= 0 || h.indexOf("site") >= 0)
    return "website";
  if (h.indexOf("note") >= 0 || h.indexOf("comment") >= 0) return "notes";
  if (h.indexOf("type") >= 0 || h.indexOf("tag") >= 0) return "type";
  return "";
}

interface ImportResult {
  created: number;
  duplicates: { row: Record<string, unknown>; matchName: string }[];
  errors: string[];
}

const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

export default function DirectoryImport({
  defaultKind = "person",
  onClose,
  onImported,
}: {
  defaultKind?: DirectoryKind;
  onClose: () => void;
  onImported?: () => void;
}) {
  // People only (Ethan, Oct 23, 2026): Directory imports create
  // contacts (people); the defaultKind prop is accepted for API
  // compatibility but no longer selectable in this dialog.
  const kind: DirectoryKind = "person";
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  /** CSV column name → target field id ("" = ignore the column). */
  const [columnTargets, setColumnTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const onFile = (file: File | null) => {
    if (!file) return;
    setResult(null);
    setError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseCsv(String(reader.result || ""));
        if (parsed.length < 2) {
          setError("That file needs a header row plus at least one data row.");
          return;
        }
        const hdrs = parsed[0].map((h, i) => (h.trim() ? h.trim() : `Column ${i + 1}`));
        const body = parsed.slice(1).map((cells) => {
          const obj: Record<string, string> = {};
          hdrs.forEach((h, i) => {
            obj[h] = (cells[i] ?? "").trim();
          });
          return obj;
        });
        const guesses: Record<string, string> = {};
        hdrs.forEach((h) => {
          guesses[h] = guessTarget(h);
        });
        setFileName(file.name);
        setHeaders(hdrs);
        setRows(body);
        setColumnTargets(guesses);
      } catch {
        setError("Could not parse that CSV file.");
      }
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  };

  /** mapping in the API's shape: { targetField: sourceColumn }. */
  const buildMapping = (): Record<string, string> => {
    const mapping: Record<string, string> = {};
    headers.forEach((h) => {
      const target = columnTargets[h];
      if (target) mapping[target] = h;
    });
    return mapping;
  };

  const mappedPreview = (): Record<string, string>[] => {
    const mapping = buildMapping();
    return rows.slice(0, 5).map((row) => {
      const out: Record<string, string> = {};
      Object.keys(mapping).forEach((target) => {
        out[target] = row[mapping[target]] || "";
      });
      return out;
    });
  };

  const submit = async () => {
    const mapping = buildMapping();
    if (!mapping.name) {
      setError("Map one column to Name before importing.");
      return;
    }
    if (rows.length === 0 || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/platform/directory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, mapping, rows }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as Partial<ImportResult>;
      setResult({
        created: typeof data.created === "number" ? data.created : 0,
        duplicates: Array.isArray(data.duplicates) ? data.duplicates : [],
        errors: Array.isArray(data.errors) ? data.errors : [],
      });
      if (onImported) onImported();
    } catch {
      setError("Import failed — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const preview = mappedPreview();
  const previewFields = Object.keys(buildMapping());

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close import"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-[#0d1f3c]/50"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-[#0f2242] sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-0 sm:h-full sm:w-full sm:max-w-[620px] sm:rounded-none">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
            Import CSV
          </h3>
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            Close
          </button>
        </div>

        <label className={labelCls} htmlFor="dir-import-file">
          CSV file
        </label>
        <input
          id="dir-import-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files ? e.target.files[0] : null)}
          className="block w-full text-sm text-slate-500 file:mr-3 file:min-h-[44px] file:rounded-xl file:border-0 file:bg-[#0d1f3c] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white dark:text-white/60 dark:file:bg-[#b8975a] dark:file:text-[#0d1f3c]"
        />
        {fileName && (
          <p className="mt-1.5 text-xs text-slate-400 dark:text-white/40">
            {fileName} · {rows.length} data row{rows.length === 1 ? "" : "s"}
          </p>
        )}

        {headers.length > 0 && (
          <>
            <p className={`${labelCls} mt-5`}>Map columns</p>
            <div className="space-y-2">
              {headers.map((h) => (
                <div key={h} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#0d1f3c] dark:text-white">
                    {h}
                  </span>
                  <span aria-hidden className="text-slate-300 dark:text-white/25">
                    →
                  </span>
                  <select
                    value={columnTargets[h] || ""}
                    onChange={(e) =>
                      setColumnTargets({ ...columnTargets, [h]: e.target.value })
                    }
                    className="min-h-[44px] w-44 shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white"
                  >
                    <option value="">Ignore</option>
                    {IMPORT_TARGET_FIELDS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <p className={`${labelCls} mt-5`}>Preview (first 5 rows, mapped)</p>
            {previewFields.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-white/40">
                Map at least one column to see the preview.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl-grad w-full min-w-[480px] text-sm">
                  <thead>
                    <tr>
                      {previewFields.map((f) => (
                        <th
                          key={f}
                          className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide"
                        >
                          {f}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr
                        key={i}
                        className="border-t border-slate-100 dark:border-white/5"
                      >
                        {previewFields.map((f) => (
                          <td
                            key={f}
                            className="max-w-[180px] truncate px-3 py-2 text-[#0d1f3c] dark:text-white"
                          >
                            {row[f] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || rows.length === 0}
                onClick={() => void submit()}
                className="btn btn-primary min-h-[44px]"
              >
                {busy ? "Importing…" : `Import ${rows.length} row${rows.length === 1 ? "" : "s"}`}
              </button>
              <span className="text-xs text-slate-400 dark:text-white/40">
                Records that already exist are reported as duplicates, not re-created.
              </span>
            </div>
          </>
        )}

        {error && (
          <p className="mt-4 rounded-xl bg-red-500/10 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        {result && (
          <div className="mt-5 rounded-2xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
              {result.created} record{result.created === 1 ? "" : "s"} created
              {result.duplicates.length > 0
                ? ` · ${result.duplicates.length} duplicate${result.duplicates.length === 1 ? "" : "s"} skipped`
                : ""}
              {result.errors.length > 0 ? ` · ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}` : ""}
            </p>
            {result.duplicates.length > 0 && (
              <div className="mt-3">
                <p className={labelCls}>Duplicates</p>
                <ul className="space-y-1 text-sm text-slate-600 dark:text-white/70">
                  {result.duplicates.map((d, i) => (
                    <li key={i}>Already exists: {d.matchName}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="mt-3">
                <p className={labelCls}>Errors</p>
                <ul className="space-y-1 text-sm text-red-700 dark:text-red-300">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
