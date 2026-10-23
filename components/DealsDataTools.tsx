"use client";

/**
 * Deals import/export tools (Phase 10): compact toolbar controls for
 * the Acquisition Pipeline. Export downloads the full deals grid from
 * GET /api/deals/export (CSV or XLSX); Import reads a .csv as text or
 * an .xlsx as base64, POSTs to /api/deals/import, shows the
 * created/updated/skipped summary inline (with per-row errors), and
 * calls onImported so the pipeline can reload.
 */

import { useRef, useState } from "react";

interface ImportError {
  row: number;
  message: string;
}

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
}

export default function DealsDataTools({
  onImported,
}: {
  onImported?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  const download = (format: "csv" | "xlsx") => {
    // Plain navigation download — the session cookie rides along and
    // the route answers with Content-Disposition: attachment.
    window.location.href = `/api/deals/export?format=${format}`;
  };

  const onFile = async (file: File) => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      let payload: { csv?: string; xlsxBase64?: string };
      if (isXlsx) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        payload = { xlsxBase64: dataUrl.split(",")[1] ?? "" };
      } else {
        payload = { csv: await file.text() };
      }
      const res = await fetch("/api/deals/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as
        | ImportResult
        | { error?: string };
      if (!res.ok) {
        setError(
          ("error" in data && data.error) || `Import failed (${res.status})`
        );
        return;
      }
      setResult(data as ImportResult);
      if (onImported) onImported();
    } catch {
      setError("Import failed — could not read or send the file.");
    } finally {
      setBusy(false);
    }
  };

  const btnCls =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/15 dark:bg-transparent dark:text-[#e8dfc8] dark:hover:bg-white/5";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/60">
          Data
        </span>
        <button type="button" className={btnCls} onClick={() => download("csv")}>
          Export CSV
        </button>
        <button type="button" className={btnCls} onClick={() => download("xlsx")}>
          Export XLSX
        </button>
        <button
          type="button"
          className={btnCls}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? "Importing…" : "Import"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          aria-label="Import deals from a CSV or XLSX file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
      {result && (
        <div className="text-xs text-slate-600 dark:text-[#e8dfc8]">
          <p>
            Import complete: {result.created} created · {result.updated}{" "}
            updated · {result.skipped} skipped.
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-1 max-h-28 list-disc overflow-y-auto pl-4">
              {result.errors.slice(0, 20).map((e, i) => (
                <li key={i}>
                  {e.row > 0 ? `Row ${e.row}: ` : ""}
                  {e.message}
                </li>
              ))}
              {result.errors.length > 20 && (
                <li>…and {result.errors.length - 20} more</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
