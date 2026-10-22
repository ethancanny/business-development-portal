"use client";

/**
 * Company picker — search box fed by GET /api/platform/companies
 * (limit 50, ?q= server filter). Used by the plan index (start a
 * plan) and the add-on pipeline (link a target company). Fetch on
 * open / on search only — no polling.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { inputCls, labelCls, type CompanyOption } from "@/components/valuecreation/types";

export default function CompanyPicker({
  value,
  onChange,
  label = "Company",
  placeholder = "Search companies…",
}: {
  value: CompanyOption | null;
  onChange: (company: CompanyOption | null) => void;
  label?: string;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CompanyOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "50" });
      if (q.trim()) qs.set("q", q.trim());
      const res = await fetch(`/api/platform/companies?${qs.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { companies?: CompanyOption[] };
      setOptions(Array.isArray(data.companies) ? data.companies : []);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  const onQuery = (q: string) => {
    setQuery(q);
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(q), 300);
  };

  if (value) {
    return (
      <div>
        <span className={labelCls}>{label}</span>
        <div className="flex items-center gap-2">
          <span className="min-h-[44px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-[#0d1f3c] dark:border-white/10 dark:bg-white/5 dark:text-white">
            {value.name}
            {value.city ? (
              <span className="ml-2 text-xs font-normal text-slate-500 dark:text-white/50">
                {value.city}
                {value.state ? `, ${value.state}` : ""}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm min-h-[44px]"
            onClick={() => {
              onChange(null);
              setQuery("");
              void load("");
            }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <label className={labelCls} htmlFor={`company-picker-${label.replace(/\W+/g, "-")}`}>
        {label}
      </label>
      <input
        id={`company-picker-${label.replace(/\W+/g, "-")}`}
        className={`${inputCls} min-h-[44px]`}
        value={query}
        placeholder={placeholder}
        onChange={(e) => onQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-white/10 dark:bg-[#132847]">
          {loading ? (
            <p className="px-3 py-3 text-sm text-slate-500 dark:text-white/50">Searching…</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-500 dark:text-white/50">
              No companies match that search.
            </p>
          ) : (
            <ul>
              {options.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#0d1f3c] transition hover:bg-[#f0f4fa] dark:text-white dark:hover:bg-white/5"
                    onClick={() => {
                      onChange(c);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                    {c.vertical && (
                      <span className="badge badge-neutral shrink-0">{c.vertical}</span>
                    )}
                    {c.city && (
                      <span className="shrink-0 text-xs text-slate-500 dark:text-white/50">
                        {c.city}
                        {c.state ? `, ${c.state}` : ""}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
