"use client";

/**
 * Deals import/export tools (Phase 10): compact toolbar controls for
 * the Investments pipeline. Export downloads the full deals grid from
 * GET /api/deals/export (CSV or XLSX) via a single dropdown button;
 * Import reads a .csv as text or an .xlsx as base64, POSTs to
 * /api/deals/import, shows the created/updated/skipped summary inline
 * (with per-row errors), and calls onImported so the pipeline can
 * reload. The Template CSV/XLSX buttons were removed Oct 24, 2026
 * (Ethan's call): in the default "All" type view they returned the
 * full grid — byte-identical to Export — because the export route
 * only honors template=1 when a type param is present.
 */

import { useEffect, useRef, useState } from "react";

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

const btnCls =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/15 dark:bg-transparent dark:text-[#e8dfc8] dark:hover:bg-white/5";

/**
 * Format dropdown: a pill button with a caret that opens a small
 * CSV / XLSX menu, following the portal's existing menu pattern
 * (StageMoveMenu / RecentDealsMenu) — closes on selection, outside
 * click, and Escape.
 */
function FormatMenu({
  label,
  onPick,
}: {
  label: string;
  onPick: (format: "csv" | "xlsx") => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`${btnCls} inline-flex items-center gap-1`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
        <span
          aria-hidden
          className="text-[10px] text-slate-400 dark:text-white/50"
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute left-0 top-full z-50 mt-1 w-32 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#132847]"
        >
          {(["csv", "xlsx"] as const).map((format) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(format);
              }}
              className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-[#e8dfc8] dark:hover:bg-white/5"
            >
              {format.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DealsDataTools({
  onImported,
  typeFilter = "all",
}: {
  onImported?: () => void;
  /** Investment Types (Step 1): the pipeline's active type filter —
   * exports follow it (per-type column sets). */
  typeFilter?: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  const typeParam = typeFilter && typeFilter !== "all" ? typeFilter : "";
  const download = (format: "csv" | "xlsx") => {
    // Plain navigation download — the session cookie rides along and
    // the route answers with Content-Disposition: attachment.
    window.location.href = `/api/deals/export?format=${format}${typeParam ? `&type=${typeParam}` : ""}`;
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

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/60">
          Data
        </span>
        <FormatMenu label="Export" onPick={download} />
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
