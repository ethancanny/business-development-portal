"use client";

/**
 * Valuation parameters settings (Phase 7) — the global defaults
 * behind every deal's economics model and deal screen: entry /
 * leverage / exit ranges, the target IRR, and the default
 * assumptions a deal inherits when its own inputs are blank.
 * Percents are stored as fractions (0.20 = 20%) and edited here
 * as plain percent numbers.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, SkeletonRows } from "@/components/ui";
import {
  API,
  api,
  inputCls,
  labelCls,
  parseNum,
  parsePct,
  pctText,
  type ValuationParams,
} from "@/components/capital/types";

type Kind = "multiple" | "pct" | "years";

interface FieldDef {
  key: keyof ValuationParams;
  label: string;
  kind: Kind;
}

const GROUPS: Array<{ title: string; fields: FieldDef[] }> = [
  {
    title: "Screening ranges",
    fields: [
      { key: "entryMultipleLow", label: "Entry multiple — low", kind: "multiple" },
      { key: "entryMultipleHigh", label: "Entry multiple — high", kind: "multiple" },
      { key: "leverageLow", label: "Leverage — low (× EBITDA)", kind: "multiple" },
      { key: "leverageHigh", label: "Leverage — high (× EBITDA)", kind: "multiple" },
      { key: "targetIrr", label: "Target IRR (%)", kind: "pct" },
    ],
  },
  {
    title: "Default deal assumptions",
    fields: [
      { key: "entryMultiple", label: "Entry multiple", kind: "multiple" },
      { key: "leverageMultiple", label: "Leverage (× EBITDA)", kind: "multiple" },
      { key: "exitMultiple", label: "Exit multiple", kind: "multiple" },
      { key: "growthPct", label: "EBITDA growth / yr (%)", kind: "pct" },
      { key: "holdYears", label: "Hold (years)", kind: "years" },
      { key: "debtPaydownPct", label: "Debt paydown by exit (%)", kind: "pct" },
    ],
  },
  {
    title: "Fees & waterfall",
    fields: [
      { key: "advisoryFeePct", label: "Advisory fee (% of price)", kind: "pct" },
      { key: "financingFeePct", label: "Financing fee (% of debt)", kind: "pct" },
      { key: "mgmtFeePct", label: "Management fees (total %)", kind: "pct" },
      { key: "prefPct", label: "Preferred return (%)", kind: "pct" },
      { key: "carryPct", label: "Carried interest (%)", kind: "pct" },
    ],
  },
];

const ALL_FIELDS = GROUPS.flatMap((g) => g.fields);

function toText(kind: Kind, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return kind === "pct" ? pctText(value) : String(value);
}

export default function ValuationParamsSettings() {
  const [params, setParams] = useState<ValuationParams | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const apply = useCallback((p: ValuationParams) => {
    setParams(p);
    const next: Record<string, string> = {};
    for (const f of ALL_FIELDS) next[f.key] = toText(f.kind, p[f.key] as number);
    setForm(next);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<{ params: ValuationParams }>(`${API}/valuation-params`);
      apply(d.params);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    setNote("");
    try {
      const payload: Record<string, number> = {};
      for (const f of ALL_FIELDS) {
        const raw = (form[f.key] ?? "").trim();
        if (raw === "") continue;
        const v = f.kind === "pct" ? parsePct(raw) : parseNum(raw);
        if (v !== null) payload[f.key] = v;
      }
      const d = await api<{ params: ValuationParams }>(`${API}/valuation-params`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      apply(d.params);
      setNote("Valuation parameters saved. Deals with blank inputs inherit the new defaults on their next computation.");
    } catch {
      setError("Could not save the valuation parameters. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonRows rows={4} />;
  if (loadFailed || !params) {
    return (
      <div>
        <p className="text-sm text-slate-500 dark:text-white/50">
          The valuation parameters could not be loaded.
        </p>
        <Button variant="secondary" size="sm" className="mt-3 min-h-[44px]" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}
      {note && (
        <p className="mb-3 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{note}</p>
      )}
      <div className="space-y-5">
        {GROUPS.map((group) => (
          <fieldset key={group.title}>
            <legend className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
              {group.title}
            </legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.fields.map((f) => (
                <div key={f.key}>
                  <label className={labelCls}>{f.label}</label>
                  <input
                    inputMode="decimal"
                    className={`${inputCls} min-h-[44px]`}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-5">
        <Button onClick={() => void save()} loading={saving} className="min-h-[44px]">
          {saving ? "Saving…" : "Save valuation parameters"}
        </Button>
      </div>
    </div>
  );
}
