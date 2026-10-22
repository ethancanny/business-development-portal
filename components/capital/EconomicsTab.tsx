"use client";

/**
 * Economics tab (Phase 7) — deal-level return model. Inputs left
 * blank inherit the global valuation parameters (Settings →
 * Valuation parameters); the inherited value shows as the field's
 * placeholder so what will be used is never a mystery. EBITDA
 * itself comes from the approved financial analysis (Phase 4B)
 * unless an override is entered here.
 *
 * Results render exactly what the server computed: sources &
 * uses, the fee stack, gross vs net investor returns, and the
 * leverage × entry × exit net-IRR sensitivity cube (one table per
 * leverage level, best cell shaded gold).
 */

import { useCallback, useEffect, useState } from "react";
import { Button, ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import {
  API,
  api,
  cardCls,
  fmtMoic,
  fmtMoneyCompact,
  fmtMoneyN,
  fmtMultiple,
  fmtPct,
  inputCls,
  labelCls,
  parseNum,
  parsePct,
  pctText,
  tdCls,
  thCls,
  type CapitalTabProps,
  type EconomicsInputs,
  type EconomicsResult,
  type ValuationParams,
} from "@/components/capital/types";

type FieldKind = "money" | "multiple" | "pct" | "years";

interface FieldDef {
  key: keyof EconomicsInputs;
  label: string;
  kind: FieldKind;
  /** Global param key this field inherits from (null = no global). */
  paramKey: keyof ValuationParams | null;
  hint?: string;
}

const FIELDS: FieldDef[] = [
  { key: "ebitdaOverride", label: "EBITDA override ($)", kind: "money", paramKey: null, hint: "Blank = EBITDA from the approved analysis" },
  { key: "entryMultiple", label: "Entry multiple", kind: "multiple", paramKey: "entryMultiple" },
  { key: "leverageMultiple", label: "Leverage (× EBITDA)", kind: "multiple", paramKey: "leverageMultiple" },
  { key: "exitMultiple", label: "Exit multiple", kind: "multiple", paramKey: "exitMultiple" },
  { key: "growthPct", label: "EBITDA growth / yr (%)", kind: "pct", paramKey: "growthPct" },
  { key: "holdYears", label: "Hold (years)", kind: "years", paramKey: "holdYears" },
  { key: "rolloverEquity", label: "Rollover equity ($)", kind: "money", paramKey: null, hint: "Seller equity rolling into the deal" },
  { key: "advisoryFeePct", label: "Advisory fee (% of price)", kind: "pct", paramKey: "advisoryFeePct" },
  { key: "financingFeePct", label: "Financing fee (% of debt)", kind: "pct", paramKey: "financingFeePct" },
  { key: "mgmtFeePct", label: "Management fees (total %)", kind: "pct", paramKey: "mgmtFeePct" },
  { key: "prefPct", label: "Preferred return (%)", kind: "pct", paramKey: "prefPct" },
  { key: "carryPct", label: "Carried interest (%)", kind: "pct", paramKey: "carryPct" },
  { key: "debtPaydownPct", label: "Debt paydown by exit (%)", kind: "pct", paramKey: "debtPaydownPct" },
];

function fieldText(kind: FieldKind, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  if (kind === "pct") return pctText(value);
  return String(value);
}

function placeholderFor(f: FieldDef, params: ValuationParams | null): string {
  if (!f.paramKey) return f.key === "ebitdaOverride" ? "From approved analysis" : "0";
  const v = params?.[f.paramKey];
  if (typeof v !== "number") return "—";
  if (f.kind === "pct") return `${pctText(v)} (global)`;
  if (f.kind === "multiple") return `${v}× (global)`;
  return `${v} (global)`;
}

interface EconData {
  inputs: EconomicsInputs | null;
  params: ValuationParams | null;
  result: EconomicsResult | null;
}

export default function EconomicsTab({ dealId }: CapitalTabProps) {
  const url = `${API}/deals/${encodeURIComponent(dealId)}/economics`;
  const [data, setData] = useState<EconData | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState("");

  const apply = useCallback((d: EconData) => {
    setData(d);
    const next: Record<string, string> = {};
    for (const f of FIELDS) {
      next[f.key] = fieldText(f.kind, d.inputs?.[f.key] as number | null);
    }
    setForm(next);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<EconData>(url);
      apply(d);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [url, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const compute = async () => {
    if (computing) return;
    setComputing(true);
    setError("");
    try {
      const inputs: Record<string, number | null> = {};
      for (const f of FIELDS) {
        const raw = (form[f.key] ?? "").trim();
        inputs[f.key] =
          raw === "" ? null : f.kind === "pct" ? parsePct(raw) : parseNum(raw);
      }
      const d = await api<EconData>(url, {
        method: "POST",
        body: JSON.stringify({ inputs, compute: true }),
      });
      apply(d);
    } catch {
      setError("Could not compute the economics. Check the inputs and try again.");
    } finally {
      setComputing(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed || !data) return <ErrorState onRetry={() => void load()} />;

  const { params, result } = data;
  const r = result?.available ? result : null;
  const ret = r?.returns ?? null;
  const su = r?.sourcesUses ?? null;

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      {/* Inputs */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Deal inputs
        </h3>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
          Blank fields inherit the global valuation parameters — the value in
          effect shows as the placeholder. Only EBITDA can be overridden
          per deal; everything else is an assumption.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className={labelCls}>{f.label}</label>
              <input
                inputMode="decimal"
                className={`${inputCls} min-h-[44px]`}
                value={form[f.key] ?? ""}
                placeholder={placeholderFor(f, params)}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              />
              {f.hint && (
                <p className="mt-1 text-xs text-slate-400 dark:text-white/40">{f.hint}</p>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => void compute()} loading={computing} className="min-h-[44px]">
            {computing ? "Computing…" : "Save inputs & compute"}
          </Button>
          {result?.computedAt && (
            <span className="text-xs text-slate-400 dark:text-white/40">
              Last computed {new Date(result.computedAt).toLocaleString("en-US")}
            </span>
          )}
        </div>
      </div>

      {/* Unavailable — honest empty state */}
      {result && !result.available && (
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Economics not available yet
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-white/50">
            {result.reason ||
              "The model needs an EBITDA figure — from an approved financial analysis, or an override above — before it can compute returns."}
          </p>
        </div>
      )}

      {r && ret && su && (
        <>
          {/* Headline tiles */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="card-surface p-4">
              <StatTile label="EBITDA" display={fmtMoneyCompact(r.ebitda ?? 0)} title={fmtMoneyN(r.ebitda)} caption={r.ebitdaSource || "Basis"} />
            </div>
            <div className="card-surface p-4">
              <StatTile label="Purchase price" display={fmtMoneyCompact(su.uses.purchasePrice)} title={fmtMoneyN(su.uses.purchasePrice)} caption="Enterprise value at entry" />
            </div>
            <div className="card-surface p-4">
              <StatTile label="Equity check" display={fmtMoneyCompact(su.sources.equity)} title={fmtMoneyN(su.sources.equity)} caption="Investor equity at close" />
            </div>
            <div className="card-surface p-4">
              <StatTile label="Net IRR / MOIC" display={`${fmtPct(ret.netIrr)} · ${fmtMoic(ret.netMoic)}`} caption="After pref, carry and fees" />
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Sources & uses */}
            <div className={cardCls}>
              <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                Sources &amp; uses
              </h3>
              <table className="mt-3 w-full">
                <tbody>
                  <tr><td className={tdCls} colSpan={2}><span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">Sources</span></td></tr>
                  <tr className="border-t border-slate-100 dark:border-white/5"><td className={tdCls}>Debt</td><td className={`${tdCls} tnum text-right`}>{fmtMoneyN(su.sources.debt)}</td></tr>
                  <tr className="border-t border-slate-100 dark:border-white/5"><td className={tdCls}>Rollover equity</td><td className={`${tdCls} tnum text-right`}>{fmtMoneyN(su.sources.rolloverEquity)}</td></tr>
                  <tr className="border-t border-slate-100 dark:border-white/5"><td className={tdCls}>Investor equity</td><td className={`${tdCls} tnum text-right`}>{fmtMoneyN(su.sources.equity)}</td></tr>
                  <tr className="border-t-2 border-slate-200 dark:border-white/15"><td className={`${tdCls} font-semibold`}>Total sources</td><td className={`${tdCls} tnum text-right font-semibold`}>{fmtMoneyN(su.sources.debt + su.sources.rolloverEquity + su.sources.equity)}</td></tr>
                  <tr><td className={tdCls} colSpan={2}><span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">Uses</span></td></tr>
                  <tr className="border-t border-slate-100 dark:border-white/5"><td className={tdCls}>Purchase price</td><td className={`${tdCls} tnum text-right`}>{fmtMoneyN(su.uses.purchasePrice)}</td></tr>
                  <tr className="border-t border-slate-100 dark:border-white/5"><td className={tdCls}>Advisory fee</td><td className={`${tdCls} tnum text-right`}>{fmtMoneyN(su.uses.advisoryFee)}</td></tr>
                  <tr className="border-t border-slate-100 dark:border-white/5"><td className={tdCls}>Financing fee</td><td className={`${tdCls} tnum text-right`}>{fmtMoneyN(su.uses.financingFee)}</td></tr>
                  <tr className="border-t-2 border-slate-200 dark:border-white/15"><td className={`${tdCls} font-semibold`}>Total uses</td><td className={`${tdCls} tnum text-right font-semibold`}>{fmtMoneyN(su.uses.totalUses)}</td></tr>
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
                Total fees in the uses: {fmtMoneyN(su.uses.totalFees)}.
              </p>
            </div>

            {/* Fee stack */}
            <div className={cardCls}>
              <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                Fee stack
              </h3>
              {(r.feeStack ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
                  No fees in this structure — every fee input is zero.
                </p>
              ) : (
                <table className="mt-3 w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-white/5">
                      <th className={thCls}>Fee</th>
                      <th className={thCls}>Basis</th>
                      <th className={`${thCls} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.feeStack.map((fee, i) => (
                      <tr key={`${fee.label}-${i}`} className="border-t border-slate-100 dark:border-white/5">
                        <td className={tdCls}>{fee.label}</td>
                        <td className={tdCls}>{fee.basis || "—"}</td>
                        <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(fee.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Gross vs net */}
          <div className={cardCls}>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              Returns — gross vs net to investors
            </h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-white/5">
                    <th className={thCls}>Measure</th>
                    <th className={`${thCls} text-right`}>Gross</th>
                    <th className={`${thCls} text-right`}>Net to investors</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-100 dark:border-white/5">
                    <td className={tdCls}>Exit EBITDA</td>
                    <td className={`${tdCls} tnum text-right`} colSpan={2}>{fmtMoneyN(ret.exitEbitda)}</td>
                  </tr>
                  <tr className="border-t border-slate-100 dark:border-white/5">
                    <td className={tdCls}>Exit value</td>
                    <td className={`${tdCls} tnum text-right`} colSpan={2}>{fmtMoneyN(ret.exitValue)}</td>
                  </tr>
                  <tr className="border-t border-slate-100 dark:border-white/5">
                    <td className={tdCls}>Equity out at exit</td>
                    <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(ret.equityOutGross)}</td>
                    <td className={`${tdCls} tnum text-right font-semibold`}>{fmtMoneyN(ret.investorOutNet)}</td>
                  </tr>
                  <tr className="border-t border-slate-100 dark:border-white/5">
                    <td className={tdCls}>MOIC</td>
                    <td className={`${tdCls} tnum text-right`}>{fmtMoic(ret.grossMoic)}</td>
                    <td className={`${tdCls} tnum text-right font-semibold`}>{fmtMoic(ret.netMoic)}</td>
                  </tr>
                  <tr className="border-t border-slate-100 dark:border-white/5">
                    <td className={tdCls}>IRR</td>
                    <td className={`${tdCls} tnum text-right`}>{fmtPct(ret.grossIrr)}</td>
                    <td className={`${tdCls} tnum text-right font-semibold`}>{fmtPct(ret.netIrr)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
              <p className="text-slate-500 dark:text-white/50">Profit <span className="tnum block font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMoneyN(ret.profit)}</span></p>
              <p className="text-slate-500 dark:text-white/50">Preferred return <span className="tnum block font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMoneyN(ret.prefAmount)}</span></p>
              <p className="text-slate-500 dark:text-white/50">Carried interest <span className="tnum block font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMoneyN(ret.carry)}</span></p>
              <p className="text-slate-500 dark:text-white/50">Management fees <span className="tnum block font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMoneyN(ret.mgmtFees)}</span></p>
            </div>
          </div>

          {/* Sensitivity cube */}
          {r.sensitivity && r.sensitivity.leverages.length > 0 && (
            <div className={cardCls}>
              <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                Sensitivity — net IRR
              </h3>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
                Entry multiple (rows) × exit multiple (columns), one table per
                leverage level. The best cell in each table is shaded gold.
              </p>
              <div className="mt-4 space-y-6">
                {r.sensitivity.leverages.map((lev, li) => {
                  const grid = r.sensitivity!.netIrr[li] ?? [];
                  let best = -Infinity;
                  grid.forEach((row) => row.forEach((v) => { if (v !== null && v > best) best = v; }));
                  return (
                    <div key={lev}>
                      <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                        Leverage {fmtMultiple(lev)}
                      </h4>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full min-w-[480px]">
                          <thead>
                            <tr className="border-b border-slate-100 dark:border-white/5">
                              <th className={thCls}>Entry \ Exit</th>
                              {r.sensitivity!.exitMultiples.map((xm) => (
                                <th key={xm} className={`${thCls} text-right`}>{fmtMultiple(xm)}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {r.sensitivity!.entryMultiples.map((em, ei) => (
                              <tr key={em} className="border-t border-slate-100 dark:border-white/5">
                                <td className={`${tdCls} font-semibold`}>{fmtMultiple(em)}</td>
                                {r.sensitivity!.exitMultiples.map((xm, xi) => {
                                  const v = grid[ei]?.[xi] ?? null;
                                  const isBest = v !== null && v === best && best > -Infinity;
                                  return (
                                    <td
                                      key={xm}
                                      className={`${tdCls} tnum text-right ${isBest ? "bg-[#b8975a]/25 font-bold text-[#0d1f3c] dark:text-white" : ""}`}
                                    >
                                      {fmtPct(v)}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
