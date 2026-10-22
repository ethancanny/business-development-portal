"use client";

/**
 * FinancialsSection (Phase 4, workstream D) — company-profile financials.
 *
 * Mounted on the company profile. Fetches GET
 * /api/platform/financials/company/[companyId] once on mount (no
 * polling): pre-aggregated summary (KPIs / chart / periods / flags)
 * plus the posted-current + drafts set index. The selected period's
 * statement lines are a detail read of GET /financials/sets/[id].
 * Uploads reuse the Phase 3 DocumentUploader; on upload completion
 * (and for existing company documents) POST /financials/extract kicks
 * off extraction — an 'unsupported' result surfaces the named OCR gap
 * in a banner instead of failing silently.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import DocumentUploader from "@/components/DocumentUploader";
import { FinancialChart, type FinChartPoint } from "@/components/FinancialCharts";
import { fmtDate, fmtMoney, fmtMoneyCompact } from "@/lib/format";

/* ---------------- Types (API contract) ---------------- */

interface LineSource {
  documentId?: string;
  sheet?: string;
  cell?: string;
  line?: number;
  page?: number;
  snippet?: string;
}

interface FinLine {
  id: string;
  setId: string;
  statementKind: string;
  lineKey: string;
  label: string;
  value: number | null;
  rawValue?: number | null;
  isDerived: boolean;
  isSubtotal: boolean;
  confidence: number | null;
  source: LineSource;
  sort: number;
}

interface FinChecks {
  bsPresent?: boolean;
  bsBalanced?: boolean | null;
  bsVariance?: number | null;
  ebitdaStated?: number | null;
  ebitdaComputed?: number | null;
  ebitdaVariance?: number | null;
  ebitdaReconciles?: boolean | null;
  cfTies?: boolean | null;
  cfVariance?: number | null;
  flags?: string[];
}

interface FinSet {
  id: string;
  seriesId: string;
  companyId: string;
  dealId: string | null;
  documentId: string | null;
  layer: string;
  basedOnSetId: string | null;
  version: number;
  supersedesId: string | null;
  restateReason: string;
  status: string;
  isCurrent: boolean;
  extractionStatus: string;
  statementKinds: string[];
  periodType: string;
  periodStart: string | null;
  periodEnd: string | null;
  fiscalYearEnd: string;
  basis: string;
  currency: string;
  unitMultiplier: number;
  unitsLabel: string;
  checks: FinChecks;
  ebitdaOverrideNote: string;
  createdBy: string;
  postedBy: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SummaryPeriod {
  setId: string;
  seriesId: string;
  layer: string;
  periodType: string;
  periodStart: string | null;
  periodEnd: string | null;
  basis: string;
  kinds: string[];
  flags: string[];
}

interface Kpi {
  revenue?: number | null;
  grossProfit?: number | null;
  grossMarginPct?: number | null;
  ebitda?: number | null;
  ebitdaMarginPct?: number | null;
  netIncome?: number | null;
  totalAssets?: number | null;
  totalLiabilities?: number | null;
  totalEquity?: number | null;
  cfo?: number | null;
  cashEnd?: number | null;
}

interface SummaryData {
  periods: SummaryPeriod[];
  kpis: Record<string, Kpi>;
  chartSeries: FinChartPoint[];
  ttm: { periodEnd: string | null; revenue: number | null; ebitda: number | null; netIncome: number | null; cfo: number | null } | null;
  yoy: { revenuePct: number | null; ebitdaPct: number | null } | null;
  latest: { periodEnd: string | null; revenue: number | null; ebitda: number | null; netIncome: number | null } | null;
  flags: string[];
  updatedAt?: string;
}

interface DocLite {
  id: string;
  name: string;
  mime: string;
  extractionStatus?: string;
  createdAt: string;
}

interface CompareRow {
  kind: string;
  lineKey: string;
  label: string;
  aValue: number | null;
  bValue: number | null;
  delta: number | null;
  deltaPct: number | null;
}

/* ---------------- Helpers ---------------- */

const KIND_LABELS: Record<string, string> = {
  is: "Income statement",
  bs: "Balance sheet",
  cf: "Cash flow",
};
const KIND_ORDER = ["is", "bs", "cf"];

const FLAG_LABELS: Record<string, string> = {
  does_not_balance: "Does not balance",
  ebitda_variance: "EBITDA variance",
  incomplete_period: "Incomplete period",
  missing_balance_sheet: "Missing balance sheet",
  missing_income_statement: "Missing income statement",
};

function flagLabel(f: string): string {
  return FLAG_LABELS[f] ?? f.replace(/_/g, " ");
}

function periodLabel(s: Pick<FinSet, "periodType" | "periodStart" | "periodEnd">): string {
  const end = s.periodEnd ? fmtDate(s.periodEnd) : "—";
  const start = s.periodStart ? fmtDate(s.periodStart) : null;
  const range = start && s.periodStart !== s.periodEnd ? `${start} – ${end}` : end;
  return `${s.periodType} · ${range}`;
}

function provenanceText(line: FinLine): string {
  const src = line.source ?? {};
  const parts: string[] = [];
  if (src.sheet && src.cell) parts.push(`${src.sheet} · ${src.cell}`);
  else if (src.cell) parts.push(src.cell);
  else if (src.sheet) parts.push(src.sheet);
  if (typeof src.page === "number") parts.push(`p. ${src.page}`);
  if (typeof src.line === "number") parts.push(`line ${src.line}`);
  if (src.snippet) {
    const snip = src.snippet.length > 64 ? `${src.snippet.slice(0, 64)}…` : src.snippet;
    parts.push(`“${snip}”`);
  }
  return parts.join(" · ");
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function marginOf(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num === null || num === undefined || den === null || den === undefined || den === 0) return null;
  return (num / den) * 100;
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

const moneyOrDash = (v: number | null): string => (v === null ? "—" : fmtMoney(v));

/** Label/value rows for the balance-sheet + cash-conversion mini-panels. */
function MiniRows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([label, v]) => (
        <div key={label} className="flex items-center justify-between gap-3">
          <dt className="text-caption">{label}</dt>
          <dd className="tnum font-medium text-[#0d1f3c] dark:text-white">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- Component ---------------- */

export default function FinancialsSection({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [sets, setSets] = useState<FinSet[]>([]);
  const [docs, setDocs] = useState<DocLite[]>([]);
  const [reloadTick, setReloadTick] = useState(0);

  const [layer, setLayer] = useState<"reported" | "adjusted">("reported");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [detail, setDetail] = useState<{ set: FinSet; lines: FinLine[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const [extractBusyId, setExtractBusyId] = useState<string | null>(null);

  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");
  const [compareRows, setCompareRows] = useState<CompareRow[] | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const loadCompany = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `/api/platform/financials/company/${encodeURIComponent(companyId)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { summary: SummaryData | null; sets: FinSet[] };
      setSummary(data.summary ?? null);
      setSets(Array.isArray(data.sets) ? data.sets : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/platform/documents?companyId=${encodeURIComponent(companyId)}&limit=50`
      );
      if (!res.ok) return;
      const data = (await res.json()) as { items?: DocLite[] };
      setDocs(Array.isArray(data.items) ? data.items : []);
    } catch {
      /* documents list is auxiliary — leave empty */
    }
  }, [companyId]);

  useEffect(() => {
    void loadCompany();
    void loadDocs();
  }, [loadCompany, loadDocs, reloadTick]);

  const postedSets = useMemo(
    () => sets.filter((s) => s.status === "posted"),
    [sets]
  );
  const postedForLayer = useMemo(
    () => postedSets.filter((s) => s.layer === layer),
    [postedSets, layer]
  );
  const draftSets = useMemo(
    () => sets.filter((s) => s.status === "draft"),
    [sets]
  );

  // Default / re-pick the period selection when data or layer changes:
  // latest posted set in the active layer, else TTM, else first draft.
  useEffect(() => {
    if (loading) return;
    const stillValid =
      selectedKey === "ttm"
        ? Boolean(summary?.ttm)
        : postedForLayer.some((s) => s.id === selectedKey);
    if (stillValid) return;
    const sorted = [...postedForLayer].sort((a, b) =>
      String(b.periodEnd ?? "").localeCompare(String(a.periodEnd ?? ""))
    );
    if (sorted.length > 0) setSelectedKey(sorted[0].id);
    else if (summary?.ttm) setSelectedKey("ttm");
    else setSelectedKey("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, layer, postedForLayer, summary]);

  const selectedSet = useMemo(
    () => sets.find((s) => s.id === selectedKey) ?? null,
    [sets, selectedKey]
  );
  const isTtm = selectedKey === "ttm";

  // Detail read for the selected set (source lines, not a recompute).
  useEffect(() => {
    if (!selectedKey || selectedKey === "ttm") {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/platform/financials/sets/${encodeURIComponent(selectedKey)}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { set: FinSet; lines: FinLine[] };
        if (!cancelled) {
          setDetail({ set: data.set, lines: Array.isArray(data.lines) ? data.lines : [] });
        }
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  /* ----- extraction ----- */

  const runExtract = useCallback(
    async (documentId: string) => {
      setExtractBusyId(documentId);
      setExtractMsg(null);
      try {
        const res = await fetch("/api/platform/financials/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId, companyId }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          status?: string;
          note?: string;
          sets?: FinSet[];
          jobId?: string;
        };
        if (data.status === "unsupported") {
          setOcrNote(
            data.note ??
              "Image OCR is not configured: no OCR provider (e.g. Azure AI Document Intelligence) is connected."
          );
        } else if (data.status === "queued") {
          setExtractMsg("Extraction queued for a large file — refresh in a moment to see the draft.");
        } else if (data.sets && data.sets.length > 0) {
          setExtractMsg(
            `Extraction created ${data.sets.length} draft set${data.sets.length === 1 ? "" : "s"} — review below.`
          );
        } else if (!res.ok) {
          setExtractMsg(data.note ?? "Extraction could not be started.");
        } else {
          setExtractMsg(data.note ?? "Extraction finished — no statement lines were found.");
        }
      } catch {
        setExtractMsg("Extraction request failed — try again.");
      } finally {
        setExtractBusyId(null);
        setReloadTick((t) => t + 1);
      }
    },
    [companyId]
  );

  /* ----- compare ----- */

  const runCompare = useCallback(async () => {
    if (!compareA || !compareB || compareA === compareB) return;
    setCompareLoading(true);
    setCompareError(null);
    try {
      const res = await fetch(
        `/api/platform/financials/company/${encodeURIComponent(companyId)}/compare?a=${encodeURIComponent(compareA)}&b=${encodeURIComponent(compareB)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows?: CompareRow[] };
      setCompareRows(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      setCompareError("Could not load the comparison — try again.");
      setCompareRows(null);
    } finally {
      setCompareLoading(false);
    }
  }, [companyId, compareA, compareB]);

  /* ----- derived display data ----- */

  const kpi = useMemo((): Kpi & { caption: string } => {
    if (isTtm && summary?.ttm) {
      const t = summary.ttm;
      return {
        revenue: t.revenue,
        ebitda: t.ebitda,
        ebitdaMarginPct: marginOf(t.ebitda, t.revenue),
        netIncome: t.netIncome,
        cfo: t.cfo,
        caption: `TTM${t.periodEnd ? ` · through ${fmtDate(t.periodEnd)}` : ""}`,
      };
    }
    if (selectedSet && summary) {
      const byEnd = selectedSet.periodEnd ? summary.kpis[selectedSet.periodEnd] : undefined;
      const byId = summary.kpis[selectedSet.id];
      const found = byEnd ?? byId;
      if (found) return { ...found, caption: periodLabel(selectedSet) };
    }
    if (detail && selectedSet && detail.set.id === selectedSet.id) {
      const get = (kind: string, key: string) =>
        detail.lines.find((l) => l.statementKind === kind && l.lineKey === key)?.value ?? null;
      const revenue = get("is", "revenue");
      const ebitda = get("is", "ebitda");
      return {
        revenue,
        ebitda,
        ebitdaMarginPct: marginOf(ebitda, revenue),
        netIncome: get("is", "net_income"),
        caption: periodLabel(selectedSet),
      };
    }
    if (summary?.latest) {
      const l = summary.latest;
      return {
        revenue: l.revenue,
        ebitda: l.ebitda,
        ebitdaMarginPct: marginOf(l.ebitda, l.revenue),
        netIncome: l.netIncome,
        caption: l.periodEnd ? `Latest · ${fmtDate(l.periodEnd)}` : "Latest",
      };
    }
    return { caption: "" };
  }, [isTtm, summary, selectedSet, detail]);

  const flags = useMemo(() => {
    const out: string[] = [];
    const push = (f?: string | null) => {
      if (f && !out.includes(f)) out.push(f);
    };
    (summary?.flags ?? []).forEach(push);
    (selectedSet?.checks?.flags ?? []).forEach(push);
    if (summary && selectedSet) {
      const p = summary.periods.find((x) => x.setId === selectedSet.id);
      (p?.flags ?? []).forEach(push);
    }
    if (selectedSet?.checks?.bsBalanced === false) push("does_not_balance");
    if (selectedSet?.checks?.ebitdaReconciles === false) push("ebitda_variance");
    return out;
  }, [summary, selectedSet]);

  const eligibleDocs = useMemo(() => {
    const used = new Set(sets.map((s) => s.documentId).filter(Boolean) as string[]);
    return docs.filter((d) => !used.has(d.id));
  }, [docs, sets]);

  const detailByKind = useMemo(() => {
    const map = new Map<string, FinLine[]>();
    if (!detail) return map;
    for (const kind of KIND_ORDER) {
      const lines = detail.lines
        .filter((l) => l.statementKind === kind)
        .sort((a, b) => a.sort - b.sort);
      if (lines.length > 0) map.set(kind, lines);
    }
    return map;
  }, [detail]);

  const bsLine = useCallback(
    (key: string): number | null =>
      detail?.lines.find((l) => l.statementKind === "bs" && l.lineKey === key)?.value ?? null,
    [detail]
  );
  const cfLine = useCallback(
    (key: string): number | null =>
      detail?.lines.find((l) => l.statementKind === "cf" && l.lineKey === key)?.value ?? null,
    [detail]
  );
  const isLineVal = useCallback(
    (key: string): number | null =>
      detail?.lines.find((l) => l.statementKind === "is" && l.lineKey === key)?.value ?? null,
    [detail]
  );

  const hasAnyFinancials = sets.length > 0 || Boolean(summary?.latest) || Boolean(summary?.ttm);
  const chartData = summary?.chartSeries ?? [];
  const exportSetId = selectedSet?.id ?? postedForLayer[0]?.id ?? "";

  return (
    <section id="financials" className="card-surface p-5" aria-label="Financials">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
          Financials
        </h2>
        <span className="text-xs text-caption">{companyName}</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setLayer("reported")}
            className={`chip min-h-[44px] ${layer === "reported" ? "chip-active" : ""}`}
          >
            Reported
          </button>
          <button
            type="button"
            onClick={() => setLayer("adjusted")}
            className={`chip min-h-[44px] ${layer === "adjusted" ? "chip-active" : ""}`}
          >
            Adjusted
          </button>
        </span>
      </div>

      {ocrNote && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <span className="font-semibold">OCR gap: </span>
          {ocrNote}
          <button
            type="button"
            onClick={() => setOcrNote(null)}
            className="btn btn-ghost btn-sm ml-2 min-h-[44px]"
          >
            Dismiss
          </button>
        </div>
      )}
      {extractMsg && (
        <p className="mb-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:bg-white/5 dark:text-white/80">
          {extractMsg}
        </p>
      )}

      {loading ? (
        <SkeletonRows rows={5} />
      ) : error ? (
        <ErrorState
          title="Could not load financials"
          message="The financials could not be loaded — the database may be unavailable. Try again in a moment."
          onRetry={() => setReloadTick((t) => t + 1)}
        />
      ) : (
        <>
          {flags.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5" aria-label="Financial flags">
              {flags.map((f) => (
                <span
                  key={f}
                  className={`badge ${f === "does_not_balance" ? "badge-danger" : "badge-warn"}`}
                >
                  {flagLabel(f)}
                </span>
              ))}
            </div>
          )}

          {!hasAnyFinancials ? (
            <EmptyState
              title="No financials yet"
              message="Upload a statement below (or extract from an existing document) — extraction creates a draft set you review and post."
            />
          ) : (
            <>
              {/* KPI tiles */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  { label: "Revenue", value: kpi.revenue, money: true },
                  { label: "EBITDA", value: kpi.ebitda, money: true },
                  { label: "EBITDA margin", value: kpi.ebitdaMarginPct, money: false },
                  { label: "Net income", value: kpi.netIncome, money: true },
                ].map((tile) => (
                  <div
                    key={tile.label}
                    className="rounded-xl border border-slate-100 px-3.5 py-3 dark:border-white/5"
                  >
                    <p className="micro-label">{tile.label}</p>
                    <p className="tnum mt-1 font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
                      {tile.value === null || tile.value === undefined
                        ? "—"
                        : tile.money
                          ? fmtMoneyCompact(tile.value)
                          : fmtPct(tile.value)}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-caption">{kpi.caption}</p>
                  </div>
                ))}
              </div>
              {summary?.yoy &&
                (summary.yoy.revenuePct !== null || summary.yoy.ebitdaPct !== null) && (
                  <p className="mt-2 text-xs text-caption">
                    YoY: revenue {fmtPct(summary.yoy.revenuePct)} · EBITDA{" "}
                    {fmtPct(summary.yoy.ebitdaPct)}
                  </p>
                )}

              {/* Period selector + export */}
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="min-w-[220px] flex-1 sm:max-w-sm">
                  <label className={labelCls} htmlFor="fin-period">
                    Period
                  </label>
                  <select
                    id="fin-period"
                    value={selectedKey}
                    onChange={(e) => setSelectedKey(e.target.value)}
                    className={`${inputCls} min-h-[44px]`}
                  >
                    {postedForLayer.length === 0 && !summary?.ttm && (
                      <option value="">No posted periods</option>
                    )}
                    {[...postedForLayer]
                      .sort((a, b) =>
                        String(b.periodEnd ?? "").localeCompare(String(a.periodEnd ?? ""))
                      )
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {periodLabel(s)} · {s.basis}
                          {s.isCurrent ? " · current" : ""}
                        </option>
                      ))}
                    {summary?.ttm && <option value="ttm">TTM (trailing twelve months)</option>}
                  </select>
                </div>
                {selectedSet && (
                  <p className="pb-2 text-xs text-caption">
                    {selectedSet.basis}
                    {selectedSet.unitsLabel ? ` · ${selectedSet.unitsLabel}` : ""}
                    {selectedSet.unitMultiplier > 1
                      ? ` · ×${selectedSet.unitMultiplier.toLocaleString()}`
                      : ""}{" "}
                    · v{selectedSet.version} · {selectedSet.layer}
                  </p>
                )}
                <span className="ml-auto flex gap-2 pb-0.5">
                  <a
                    href={
                      exportSetId
                        ? `/api/platform/financials/company/${encodeURIComponent(companyId)}/export?format=xlsx&setId=${encodeURIComponent(exportSetId)}`
                        : undefined
                    }
                    aria-disabled={!exportSetId}
                    className={`btn btn-secondary btn-sm min-h-[44px] ${exportSetId ? "" : "pointer-events-none opacity-50"}`}
                  >
                    Export XLSX
                  </a>
                  <a
                    href={
                      exportSetId
                        ? `/api/platform/financials/company/${encodeURIComponent(companyId)}/export?format=pdf&setId=${encodeURIComponent(exportSetId)}`
                        : undefined
                    }
                    aria-disabled={!exportSetId}
                    className={`btn btn-secondary btn-sm min-h-[44px] ${exportSetId ? "" : "pointer-events-none opacity-50"}`}
                  >
                    Export PDF
                  </a>
                </span>
              </div>

              {/* Chart */}
              {chartData.length > 0 ? (
                <div className="mt-4">
                  <FinancialChart data={chartData} />
                </div>
              ) : (
                <p className="mt-4 text-sm text-caption">
                  No posted periods to chart yet.
                </p>
              )}

              {/* Statement table for the selected set */}
              <div className="mt-5">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
                  Statements
                </h3>
                {isTtm ? (
                  <p className="text-sm text-caption">
                    TTM is an aggregate of posted periods — select a single period above to see
                    its statement lines.
                  </p>
                ) : detailLoading ? (
                  <SkeletonRows rows={4} />
                ) : !detail || detail.lines.length === 0 ? (
                  <p className="text-sm text-caption">No statement lines for this period.</p>
                ) : (
                  <div className="space-y-5">
                    {KIND_ORDER.filter((k) => detailByKind.has(k)).map((kind) => (
                      <div key={kind} className="overflow-x-auto">
                        <p className="micro-label mb-1.5">{KIND_LABELS[kind]}</p>
                        <table className="tbl-grad w-full min-w-[480px] text-sm">
                          <thead>
                            <tr>
                              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Line</th>
                              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(detailByKind.get(kind) ?? []).map((line) => {
                              const prov = provenanceText(line);
                              const docId = line.source?.documentId ?? detail.set.documentId;
                              return (
                                <tr
                                  key={line.id}
                                  className="border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5"
                                >
                                  <td className="px-3 py-2.5">
                                    <span
                                      className={`text-[#0d1f3c] dark:text-white ${line.isSubtotal ? "font-semibold" : ""}`}
                                    >
                                      {line.label || line.lineKey}
                                    </span>
                                    {line.isDerived && (
                                      <span className="badge badge-neutral ml-2">derived</span>
                                    )}
                                    {(prov || docId) && (
                                      <span className="mt-0.5 block text-xs text-caption">
                                        {prov}
                                        {docId && (
                                          <>
                                            {prov ? " · " : ""}
                                            <Link
                                              href={`/documents?doc=${encodeURIComponent(docId)}`}
                                              className="font-semibold text-gold-700 hover:underline dark:text-gold-400"
                                            >
                                              View source
                                            </Link>
                                          </>
                                        )}
                                      </span>
                                    )}
                                  </td>
                                  <td className="tnum px-3 py-2.5 text-right font-medium text-[#0d1f3c] dark:text-white">
                                    {line.value === null || line.value === undefined
                                      ? "—"
                                      : fmtMoney(line.value)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Balance-sheet snapshot + cash conversion */}
              {detail && !isTtm && (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-100 p-4 dark:border-white/5">
                    <p className="micro-label mb-2">Balance-sheet snapshot</p>
                    <MiniRows
                      rows={[
                        ["Cash", moneyOrDash(bsLine("cash"))],
                        ["Total assets", moneyOrDash(bsLine("total_assets"))],
                        ["Total liabilities", moneyOrDash(bsLine("total_liabilities"))],
                        ["Total equity", moneyOrDash(bsLine("total_equity"))],
                        [
                          "Current ratio",
                          (() => {
                            const tca = bsLine("total_current_assets");
                            const tcl = bsLine("total_current_liabilities");
                            return tca !== null && tcl !== null && tcl !== 0
                              ? (tca / tcl).toFixed(2)
                              : "—";
                          })(),
                        ],
                      ]}
                    />
                    {detail.set.checks?.bsBalanced !== null &&
                      detail.set.checks?.bsBalanced !== undefined && (
                        <p className="pt-2 text-xs">
                          {detail.set.checks.bsBalanced ? (
                            <span className="text-emerald-700 dark:text-emerald-300">
                              ✓ Balance sheet balances
                            </span>
                          ) : (
                            <span className="text-red-700 dark:text-red-300">
                              ⚠ Does not balance
                              {detail.set.checks.bsVariance !== null &&
                              detail.set.checks.bsVariance !== undefined
                                ? ` · variance ${fmtMoney(detail.set.checks.bsVariance)}`
                                : ""}
                            </span>
                          )}
                        </p>
                      )}
                  </div>
                  <div className="rounded-xl border border-slate-100 p-4 dark:border-white/5">
                    <p className="micro-label mb-2">Cash conversion</p>
                    <MiniRows
                      rows={[
                        ["Operating (CFO)", moneyOrDash(cfLine("cfo"))],
                        ["Investing (CFI)", moneyOrDash(cfLine("cfi"))],
                        ["Financing (CFF)", moneyOrDash(cfLine("cff"))],
                        ["Net change in cash", moneyOrDash(cfLine("net_change_cash"))],
                        ["Ending cash", moneyOrDash(cfLine("cash_end"))],
                        [
                          "CFO vs net income",
                          (() => {
                            const cfo = cfLine("cfo");
                            const ni = isLineVal("net_income");
                            return cfo !== null && ni !== null && ni !== 0
                              ? `${(cfo / ni).toFixed(2)}×`
                              : "—";
                          })(),
                        ],
                      ]}
                    />
                  </div>
                </div>
              )}

              {/* Compare */}
              {postedSets.length >= 2 && (
                <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
                    Compare periods
                  </h3>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[200px] flex-1 sm:max-w-xs">
                      <label className={labelCls} htmlFor="fin-cmp-a">Period A</label>
                      <select
                        id="fin-cmp-a"
                        value={compareA}
                        onChange={(e) => setCompareA(e.target.value)}
                        className={`${inputCls} min-h-[44px]`}
                      >
                        <option value="">Select…</option>
                        {postedSets.map((s) => (
                          <option key={s.id} value={s.id}>
                            {periodLabel(s)} · {s.layer}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="min-w-[200px] flex-1 sm:max-w-xs">
                      <label className={labelCls} htmlFor="fin-cmp-b">Period B</label>
                      <select
                        id="fin-cmp-b"
                        value={compareB}
                        onChange={(e) => setCompareB(e.target.value)}
                        className={`${inputCls} min-h-[44px]`}
                      >
                        <option value="">Select…</option>
                        {postedSets.map((s) => (
                          <option key={s.id} value={s.id}>
                            {periodLabel(s)} · {s.layer}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      disabled={!compareA || !compareB || compareA === compareB || compareLoading}
                      onClick={() => void runCompare()}
                      className="btn btn-primary min-h-[44px]"
                    >
                      {compareLoading ? "Comparing…" : "Compare"}
                    </button>
                  </div>
                  {compareA && compareB && compareA === compareB && (
                    <p className="mt-2 text-xs text-caption">Pick two different periods.</p>
                  )}
                  {compareError && (
                    <p className="mt-2 text-sm text-red-600 dark:text-red-300">{compareError}</p>
                  )}
                  {compareRows !== null &&
                    (compareRows.length === 0 ? (
                      <p className="mt-3 text-sm text-caption">No comparable lines.</p>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="tbl-grad w-full min-w-[560px] text-sm">
                          <thead>
                            <tr>
                              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Line</th>
                              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">A</th>
                              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">B</th>
                              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Δ</th>
                              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Δ %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {compareRows.map((r, i) => (
                              <tr
                                key={`${r.kind}-${r.lineKey}-${r.label}-${i}`}
                                className="border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5"
                              >
                                <td className="px-3 py-2.5 text-[#0d1f3c] dark:text-white">
                                  <span className="text-caption">{KIND_LABELS[r.kind] ?? r.kind} · </span>
                                  {r.label || r.lineKey}
                                </td>
                                <td className="tnum px-3 py-2.5 text-right text-[#0d1f3c] dark:text-white">
                                  {r.aValue === null ? "—" : fmtMoney(r.aValue)}
                                </td>
                                <td className="tnum px-3 py-2.5 text-right text-[#0d1f3c] dark:text-white">
                                  {r.bValue === null ? "—" : fmtMoney(r.bValue)}
                                </td>
                                <td className="tnum px-3 py-2.5 text-right font-medium text-[#0d1f3c] dark:text-white">
                                  {r.delta === null ? "—" : fmtMoney(r.delta)}
                                </td>
                                <td className="tnum px-3 py-2.5 text-right text-[#0d1f3c] dark:text-white">
                                  {fmtPct(r.deltaPct)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}

          {/* Drafts */}
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Draft sets
            </h3>
            {draftSets.length === 0 ? (
              <p className="text-sm text-caption">No drafts awaiting review.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/5">
                {draftSets.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <span className="min-w-0 flex-1 text-sm text-slate-800 dark:text-white/90">
                      <span className="font-medium">{periodLabel(s)}</span>
                      <span className="text-caption">
                        {" "}
                        · {s.layer} · {s.basis} · v{s.version}
                        {s.statementKinds.length > 0
                          ? ` · ${s.statementKinds.map((k) => KIND_LABELS[k] ?? k).join(", ")}`
                          : ""}
                      </span>
                    </span>
                    <span className="badge badge-warn">draft</span>
                    {s.extractionStatus === "unsupported" && (
                      <span className="badge badge-danger">OCR gap</span>
                    )}
                    <Link
                      href={`/financials/review/${encodeURIComponent(s.id)}`}
                      className="btn btn-primary btn-sm min-h-[44px]"
                    >
                      Review
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Upload + extract from existing documents */}
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Add financials
            </h3>
            <p className="mb-3 text-xs text-caption">
              Upload a financial statement — extraction runs automatically and creates a draft
              for review. Nothing is posted until you review it.
            </p>
            <DocumentUploader
              companyId={companyId}
              onUploaded={(result) => {
                if (result.document?.id) void runExtract(result.document.id);
                else setReloadTick((t) => t + 1);
              }}
            />
            {eligibleDocs.length > 0 && (
              <div className="mt-4">
                <p className="micro-label mb-1.5">Extract from an existing document</p>
                <ul className="divide-y divide-slate-100 dark:divide-white/5">
                  {eligibleDocs.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-white/90">
                        {d.name}
                        <span className="text-caption"> · {d.mime || "—"}</span>
                      </span>
                      <button
                        type="button"
                        disabled={extractBusyId === d.id}
                        onClick={() => void runExtract(d.id)}
                        className="btn btn-secondary btn-sm min-h-[44px]"
                      >
                        {extractBusyId === d.id ? "Extracting…" : "Extract financials"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
