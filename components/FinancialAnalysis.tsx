"use client";

/**
 * FinancialAnalysis (Part 4B, WS-D) — automated financial analysis panel.
 *
 * Mounted on the company profile directly after <FinancialsSection />.
 * Reads the pre-aggregated payload from GET
 * /api/platform/financials/analysis/company/[companyId]/analysis ->
 * { analysis, payload, adjustments } — never recomputes from raw lines.
 *
 * Payload conventions (contract): pct metric values are FRACTIONS
 * (0.25 = 25%) and are formatted ×100 here; money goes through
 * fmtMoney / fmtMoneyCompact from @/lib/format. Every figure shows its
 * source / formula / confidence where the payload carries them, and the
 * deal screen shows assumptions + basis + notes verbatim.
 *
 * Sections (the 12 visualizations): ratio dashboard with benchmark
 * band bars, trend + anomalies, margin bridge + adjustment log,
 * working-capital seasonality + peg, monthly bars, balance-sheet
 * composition, cash conversion, concentration, deal screen, integrity
 * panel, benchmarks panel, and the missing-inputs list.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import IntegrityPanel, {
  type IntegrityCheckResult,
} from "@/components/IntegrityPanel";
import {
  BsCompositionChart,
  CashConversionChart,
  MarginBridgeChart,
  MonthlyChart,
  TrendChart,
  WorkingCapitalChart,
  type TrendPoint,
} from "@/components/FinancialAnalysisCharts";
import { fmtDate, fmtMoney, fmtMoneyCompact } from "@/lib/format";

/* ---------------- Types (structural, mirrors lib/finanalysis/types.ts) ---------------- */

interface AnalysisMeta {
  id: string;
  companyId: string;
  status: string; // 'draft' | 'approved'
  isCurrent: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface MetricBenchmark {
  median: number | null;
  p25: number | null;
  p75: number | null;
  thin: boolean;
}

interface MetricValue {
  key: string;
  label: string;
  group: "liquidity" | "leverage" | "profitability" | "efficiency" | "growth";
  value: number | null;
  unit: "x" | "pct" | "usd" | "days" | "count";
  prior: number | null;
  deltaPct: number | null;
  formula: string;
  sourceLines: string[];
  confidence: "high" | "medium" | "low";
  benchmark: MetricBenchmark | null;
  note: string;
}

interface AnomalyFlag {
  rule: string;
  severity: "high" | "medium" | "low";
  message: string;
  setId: string | null;
  periodEnd: string | null;
  figures: Record<string, number | null>;
  sourceLines: string[];
}

interface AdjustmentRecord {
  id: string;
  analysisId: string;
  companyId: string;
  reportedSetId: string;
  kind: string;
  label: string;
  amount: number | null;
  direction: string; // 'add' | 'subtract'
  rationale: string;
  source: Record<string, unknown>;
  requiresInput: string | null;
  status: string; // 'proposed' | 'accepted' | 'rejected'
  decidedBy: string | null;
  decidedAt: string | null;
  decidedAmount: number | null;
  adjustedSetId: string | null;
  createdAt: string;
}

interface BenchmarkRecord {
  id: string;
  industry: string;
  metricKey: string;
  median: number | null;
  p25: number | null;
  p75: number | null;
  sampleSize: number | null;
  source: string;
  note: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface DealScreenAssumptions {
  leverageMultiple: number;
  feesPct: number;
  growthPct: number;
  holdYears: number;
  debtPaydownPct: number;
}

interface DealScreenGridRow {
  entryMultiple: number;
  enterpriseValue: number | null;
  debt: number | null;
  fees: number | null;
  equityCheck: number | null;
  exitEbitda: number | null;
  exitValue: number | null;
  equityOut: number | null;
  moic: number | null;
  irr: number | null;
}

interface DealScreenData {
  ebitda: number | null;
  ebitdaBasis: string;
  basis: string;
  assumptionsUsed: DealScreenAssumptions;
  assumptionNotes: string[];
  grid: DealScreenGridRow[];
  sensitivity: { entryMultiple: number; exitMultiple: number; irr: number | null; moic: number | null }[];
}

interface AnalysisPayload {
  companyId: string;
  generatedAt: string;
  industry: string;
  periods: { setId: string; periodEnd: string | null; periodType: string; periodStart: string | null; layer: string }[];
  metricsByPeriod: { setId: string; periodEnd: string | null; metrics: MetricValue[] }[];
  integrity: IntegrityCheckResult[];
  anomalies: AnomalyFlag[];
  coverage: { rule: string; reason: string }[];
  marginBridge: {
    reportedSetId: string;
    reportedEbitda: number | null;
    items: { label: string; amount: number }[];
    adjustedEbitda: number | null;
    adjustedSetId: string | null;
  } | null;
  revenueQuality: {
    periodEnd: string | null;
    revenue: number | null;
    identifiedOneTime: number | null;
    identifiedRecurring: number | null;
    concentration: {
      available: boolean;
      customers: { name: string; amount: number; sharePct: number }[];
      top1Pct: number | null;
      top5Pct: number | null;
      sourceSetId: string | null;
    };
    backlog: { amount: number | null; sourceSetId: string | null };
    missingInputs: string[];
  };
  workingCapital: {
    points: { setId: string; periodEnd: string | null; wc: number; revenue: number | null; wcPctRevenue: number | null }[];
    normalizedWcPct: number | null;
    peg: { low: number | null; mid: number | null; high: number | null; basis: string };
    seasonality: { month: number; index: number | null }[];
    missingInputs: string[];
  };
  dealScreen: DealScreenData;
  chartData: {
    monthly: { periodEnd: string | null; revenue: number | null; ebitda: number | null; seasonalityIndex: number | null }[];
    bsComposition: {
      periodEnd: string | null;
      assets: { cash: number | null; accountsReceivable: number | null; inventory: number | null; otherCurrent: number | null; ppe: number | null; intangibles: number | null; other: number | null };
      liabEquity: { accountsPayable: number | null; currentDebt: number | null; otherCurrent: number | null; longTermDebt: number | null; otherLiab: number | null; equity: number | null };
    }[];
    cashConversion: { periodEnd: string | null; ebitda: number | null; cfo: number | null; cfi: number | null; fcf: number | null } | null;
  };
  missingInputs: string[];
}

/* ---------------- Helpers ---------------- */

const API = "/api/platform/financials/analysis";

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

const GROUP_ORDER: MetricValue["group"][] = [
  "liquidity",
  "leverage",
  "profitability",
  "efficiency",
  "growth",
];
const GROUP_LABELS: Record<string, string> = {
  liquidity: "Liquidity",
  leverage: "Leverage",
  profitability: "Profitability",
  efficiency: "Efficiency",
  growth: "Growth",
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** pct values in the payload are FRACTIONS — format ×100. */
function fmtFracPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtSignedFracPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = fmtFracPct(Math.abs(v));
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}`;
}

/** Format a metric value by its unit (pct = fraction). */
function fmtMetric(v: number | null | undefined, unit: MetricValue["unit"]): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  switch (unit) {
    case "pct":
      return fmtFracPct(v);
    case "usd":
      return fmtMoney(v);
    case "x":
      return `${v.toFixed(2)}×`;
    case "days":
      return `${v.toFixed(0)} days`;
    default:
      return String(v);
  }
}

function confidenceChip(c: MetricValue["confidence"]): { label: string; cls: string } {
  if (c === "high")
    return { label: "high", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" };
  if (c === "medium")
    return { label: "medium", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" };
  return { label: "low", cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" };
}

function severityChip(s: AnomalyFlag["severity"]): string {
  if (s === "high") return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
  if (s === "medium") return "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";
  return "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/60";
}

/**
 * Anomaly figures are mixed-unit (engine-verified): margins / growth /
 * changePct are FRACTIONS, top1Pct-style keys are percentage POINTS,
 * counts are plain, everything else is money.
 */
function fmtAnomalyFigure(key: string, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (/top1pct|priortop1pct|changepts/i.test(key)) return `${v.toFixed(1)}%`;
  if (/margin|growth|changepct|change/i.test(key)) return fmtFracPct(v);
  if (/steps|count/i.test(key)) return String(v);
  return fmtMoney(v);
}

function parseNum(text: string): number | null {
  const t = text.replace(/[$,\s%]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
      {children}
    </h3>
  );
}

/** Benchmark band bar (divs): p25–p75 band, median tick, value marker. */
function BenchmarkBand({ metric }: { metric: MetricValue }) {
  const b = metric.benchmark;
  if (!b || (b.p25 === null && b.p75 === null && b.median === null)) {
    return <span className="text-xs text-caption">No benchmark</span>;
  }
  const vals = [b.p25, b.p75, b.median, metric.value].filter(
    (v): v is number => v !== null && Number.isFinite(v)
  );
  if (vals.length === 0) return <span className="text-xs text-caption">No benchmark</span>;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.2 || Math.abs(hi) * 0.1 || 1;
  const scaleLo = lo - pad;
  const scaleHi = hi + pad;
  const pos = (v: number) =>
    Math.min(100, Math.max(0, ((v - scaleLo) / (scaleHi - scaleLo)) * 100));
  return (
    <div className="min-w-[120px]">
      <div className="relative h-5 rounded-md bg-slate-100 dark:bg-white/5">
        {b.p25 !== null && b.p75 !== null && (
          <div
            className="absolute bottom-1 top-1 rounded bg-[#b8975a]/35"
            style={{ left: `${pos(b.p25)}%`, width: `${Math.max(2, pos(b.p75) - pos(b.p25))}%` }}
            title={`p25 ${fmtMetric(b.p25, metric.unit)} – p75 ${fmtMetric(b.p75, metric.unit)}`}
          />
        )}
        {b.median !== null && (
          <div
            className="absolute bottom-0 top-0 w-0.5 bg-[#b8975a]"
            style={{ left: `${pos(b.median)}%` }}
            title={`Median ${fmtMetric(b.median, metric.unit)}`}
          />
        )}
        {metric.value !== null && (
          <div
            className="absolute bottom-[-2px] top-[-2px] w-[3px] rounded bg-[#0d1f3c] dark:bg-white"
            style={{ left: `calc(${pos(metric.value)}% - 1px)` }}
            title={`This company ${fmtMetric(metric.value, metric.unit)}`}
          />
        )}
      </div>
      <p className="mt-0.5 text-[11px] leading-tight text-caption">
        Median {fmtMetric(b.median, metric.unit)} · p25–p75 {fmtMetric(b.p25, metric.unit)}–
        {fmtMetric(b.p75, metric.unit)}
        {b.thin ? " · preliminary (thin sample)" : ""}
      </p>
    </div>
  );
}

function sourceText(source: Record<string, unknown>): string {
  const parts: string[] = [];
  const sheet = source.sheet;
  const cell = source.cell;
  if (typeof sheet === "string" && typeof cell === "string") parts.push(`${sheet} · ${cell}`);
  else if (typeof cell === "string") parts.push(cell);
  else if (typeof sheet === "string") parts.push(sheet);
  if (typeof source.page === "number") parts.push(`p. ${source.page}`);
  if (typeof source.line === "number") parts.push(`line ${source.line}`);
  if (typeof source.snippet === "string" && source.snippet) {
    const snip = source.snippet.length > 64 ? `${source.snippet.slice(0, 64)}…` : source.snippet;
    parts.push(`“${snip}”`);
  }
  return parts.join(" · ");
}

/* ---------------- Component ---------------- */

export default function FinancialAnalysis({ companyId }: { companyId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisMeta | null>(null);
  const [payload, setPayload] = useState<AnalysisPayload | null>(null);
  const [adjustments, setAdjustments] = useState<AdjustmentRecord[]>([]);
  const [reloadTick, setReloadTick] = useState(0);

  const [running, setRunning] = useState(false);
  const [approving, setApproving] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [ratioPeriod, setRatioPeriod] = useState<string>(""); // setId; '' = latest
  const [adjInputs, setAdjInputs] = useState<Record<string, { amount: string; inputValue: string }>>({});
  const [decidingId, setDecidingId] = useState<string | null>(null);

  // Deal screen (local copy; starts from payload.dealScreen)
  const [dealScreen, setDealScreen] = useState<DealScreenData | null>(null);
  const [dsForm, setDsForm] = useState({ leverage: "3.0", feesPct: "3", growthPct: "5", holdYears: "5", paydownPct: "0" });
  const [dsBusy, setDsBusy] = useState(false);
  const [dsError, setDsError] = useState<string | null>(null);
  const [dsInitFor, setDsInitFor] = useState<string>("");

  // Benchmarks
  const [benchmarks, setBenchmarks] = useState<BenchmarkRecord[]>([]);
  const [benchForm, setBenchForm] = useState({ industry: "", metricKey: "", median: "", p25: "", p75: "", sampleSize: "", note: "" });
  const [benchBusy, setBenchBusy] = useState(false);
  const [benchMsg, setBenchMsg] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);

  const loadAnalysis = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`${API}/company/${encodeURIComponent(companyId)}/analysis`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        analysis: AnalysisMeta | null;
        payload: AnalysisPayload | null;
        adjustments?: AdjustmentRecord[];
      };
      setAnalysis(data.analysis ?? null);
      setPayload(data.payload ?? null);
      setAdjustments(Array.isArray(data.adjustments) ? data.adjustments : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const loadBenchmarks = useCallback(async () => {
    try {
      const res = await fetch(`${API}/benchmarks`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        benchmarks?: BenchmarkRecord[];
        items?: BenchmarkRecord[];
      };
      const list = Array.isArray(data)
        ? (data as BenchmarkRecord[])
        : (data.benchmarks ?? data.items ?? []);
      setBenchmarks(Array.isArray(list) ? list : []);
    } catch {
      /* benchmarks panel is auxiliary */
    }
  }, []);

  useEffect(() => {
    void loadAnalysis();
    void loadBenchmarks();
  }, [loadAnalysis, loadBenchmarks, reloadTick]);

  // Seed the deal-screen form + grid from the payload once per analysis.
  useEffect(() => {
    if (!payload?.dealScreen || !analysis) return;
    if (dsInitFor === analysis.id) return;
    setDsInitFor(analysis.id);
    setDealScreen(payload.dealScreen);
    const a = payload.dealScreen.assumptionsUsed;
    if (a) {
      setDsForm({
        leverage: String(a.leverageMultiple ?? 3),
        feesPct: String(((a.feesPct ?? 0.03) * 100).toFixed(2)),
        growthPct: String(((a.growthPct ?? 0.05) * 100).toFixed(2)),
        holdYears: String(a.holdYears ?? 5),
        paydownPct: String(((a.debtPaydownPct ?? 0) * 100).toFixed(2)),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, analysis]);

  /* ----- actions ----- */

  const runAnalysis = useCallback(async () => {
    setRunning(true);
    setActionMsg(null);
    setActionError(null);
    try {
      const res = await fetch(`${API}/company/${encodeURIComponent(companyId)}/analysis/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; jobId?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setActionMsg("Analysis run queued — the panel refreshes with the new results in a moment.");
      await loadAnalysis();
    } catch (err) {
      setActionError(err instanceof Error ? `Could not run the analysis: ${err.message}` : "Could not run the analysis — try again.");
    } finally {
      setRunning(false);
    }
  }, [companyId, loadAnalysis]);

  const approveAnalysis = useCallback(async () => {
    if (!analysis) return;
    setApproving(true);
    setActionMsg(null);
    setActionError(null);
    try {
      const res = await fetch(`${API}/company/${encodeURIComponent(companyId)}/analysis/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId: analysis.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setActionMsg("Analysis approved and published.");
      await loadAnalysis();
    } catch (err) {
      setActionError(err instanceof Error ? `Could not approve: ${err.message}` : "Could not approve — try again.");
    } finally {
      setApproving(false);
    }
  }, [companyId, analysis, loadAnalysis]);

  const decide = useCallback(
    async (adj: AdjustmentRecord, decision: "accept" | "reject") => {
      setDecidingId(adj.id);
      setActionMsg(null);
      setActionError(null);
      try {
        const inputs = adjInputs[adj.id] ?? { amount: "", inputValue: "" };
        const body: Record<string, unknown> = { decision };
        const amount = parseNum(inputs.amount);
        const inputValue = parseNum(inputs.inputValue);
        if (amount !== null) body.amount = amount;
        if (inputValue !== null) body.inputValue = inputValue;
        const res = await fetch(`${API}/adjustments/${encodeURIComponent(adj.id)}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setActionMsg(
          decision === "accept"
            ? `Accepted “${adj.label}” — applied to the adjusted (QoE) layer; the analysis re-runs so the margin bridge reflects it.`
            : `Rejected “${adj.label}”.`
        );
        await loadAnalysis();
      } catch (err) {
        setActionError(
          err instanceof Error && err.message === "amount_required"
            ? "An amount is required to accept this adjustment — enter an amount (or the market input value) first."
            : err instanceof Error
              ? `Could not save the decision: ${err.message}`
              : "Could not save the decision — try again."
        );
      } finally {
        setDecidingId(null);
      }
    },
    [adjInputs, loadAnalysis]
  );

  const recalcDealScreen = useCallback(async () => {
    setDsBusy(true);
    setDsError(null);
    try {
      const assumptions: DealScreenAssumptions = {
        leverageMultiple: parseNum(dsForm.leverage) ?? 3,
        feesPct: (parseNum(dsForm.feesPct) ?? 3) / 100,
        growthPct: (parseNum(dsForm.growthPct) ?? 5) / 100,
        holdYears: parseNum(dsForm.holdYears) ?? 5,
        debtPaydownPct: (parseNum(dsForm.paydownPct) ?? 0) / 100,
      };
      const res = await fetch(`${API}/company/${encodeURIComponent(companyId)}/dealscreen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assumptions }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        dealScreen?: DealScreenData;
        screen?: DealScreenData;
      } & Partial<DealScreenData>;
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const screen = data.dealScreen ?? data.screen ?? (data.grid ? (data as DealScreenData) : null);
      if (screen) setDealScreen(screen);
      else setDsError("The deal screen returned no grid — try again.");
    } catch (err) {
      setDsError(err instanceof Error ? `Could not recalculate: ${err.message}` : "Could not recalculate — try again.");
    } finally {
      setDsBusy(false);
    }
  }, [companyId, dsForm]);

  const saveBenchmark = useCallback(async () => {
    if (!benchForm.metricKey.trim()) {
      setBenchMsg("A metric key is required (e.g. current_ratio).");
      return;
    }
    setBenchBusy(true);
    setBenchMsg(null);
    try {
      const res = await fetch(`${API}/benchmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry: benchForm.industry.trim() || payload?.industry || "general",
          metricKey: benchForm.metricKey.trim(),
          median: parseNum(benchForm.median),
          p25: parseNum(benchForm.p25),
          p75: parseNum(benchForm.p75),
          sampleSize: parseNum(benchForm.sampleSize),
          note: benchForm.note.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setBenchMsg("Benchmark saved.");
      setBenchForm({ industry: "", metricKey: "", median: "", p25: "", p75: "", sampleSize: "", note: "" });
      await loadBenchmarks();
    } catch (err) {
      setBenchMsg(err instanceof Error ? `Could not save: ${err.message}` : "Could not save the benchmark — try again.");
    } finally {
      setBenchBusy(false);
    }
  }, [benchForm, payload, loadBenchmarks]);

  const importBenchmarks = useCallback(async () => {
    if (!csvText.trim()) {
      setBenchMsg("Paste CSV first (header: industry,metric_key,median,p25,p75,sample_size,note).");
      return;
    }
    setCsvBusy(true);
    setBenchMsg(null);
    try {
      const res = await fetch(`${API}/benchmarks/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        created?: number;
        updated?: number;
        errors?: string[];
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const parts = [
        `Imported: ${data.created ?? 0} created, ${data.updated ?? 0} updated.`,
        ...(data.errors && data.errors.length > 0 ? [`Errors: ${data.errors.join("; ")}`] : []),
      ];
      setBenchMsg(parts.join(" "));
      setCsvText("");
      await loadBenchmarks();
    } catch (err) {
      setBenchMsg(err instanceof Error ? `Import failed: ${err.message}` : "Import failed — try again.");
    } finally {
      setCsvBusy(false);
    }
  }, [csvText, loadBenchmarks]);

  /* ----- derived display data ----- */

  const missingInputs = useMemo(() => {
    if (!payload) return [];
    const out: string[] = [];
    const push = (s?: string | null) => {
      if (s && !out.includes(s)) out.push(s);
    };
    (payload.missingInputs ?? []).forEach(push);
    (payload.revenueQuality?.missingInputs ?? []).forEach(push);
    (payload.workingCapital?.missingInputs ?? []).forEach(push);
    return out;
  }, [payload]);

  const trendPoints = useMemo((): TrendPoint[] => {
    if (!payload) return [];
    const monthlyByEnd = new Map(
      (payload.chartData?.monthly ?? []).map((m) => [m.periodEnd ?? "", m])
    );
    const wcBySet = new Map(
      (payload.workingCapital?.points ?? []).map((p) => [p.setId, p])
    );
    return (payload.metricsByPeriod ?? []).map((mp) => {
      const byKey = new Map(mp.metrics.map((m) => [m.key, m]));
      const frac = (key: string) => {
        const v = byKey.get(key)?.value;
        return v === null || v === undefined ? null : v * 100;
      };
      const monthly = mp.periodEnd ? monthlyByEnd.get(mp.periodEnd) : undefined;
      return {
        label: mp.periodEnd ? fmtDate(mp.periodEnd) : "—",
        periodEnd: mp.periodEnd,
        revenue: monthly?.revenue ?? wcBySet.get(mp.setId)?.revenue ?? null,
        ebitda: monthly?.ebitda ?? null,
        grossMarginPct: frac("gross_margin"),
        ebitdaMarginPct: frac("ebitda_margin"),
      };
    });
  }, [payload]);

  const ratioMetrics = useMemo(() => {
    if (!payload || (payload.metricsByPeriod ?? []).length === 0) return null;
    const chosen =
      payload.metricsByPeriod.find((mp) => mp.setId === ratioPeriod) ??
      payload.metricsByPeriod[payload.metricsByPeriod.length - 1];
    return chosen;
  }, [payload, ratioPeriod]);

  const sensitivityEntries = useMemo(() => {
    const cells = dealScreen?.sensitivity ?? [];
    const entries = Array.from(new Set(cells.map((c) => c.entryMultiple))).sort((a, b) => a - b);
    const exits = Array.from(new Set(cells.map((c) => c.exitMultiple))).sort((a, b) => a - b);
    return { entries, exits, cells };
  }, [dealScreen]);

  /* ----- render ----- */

  if (loading) {
    return (
      <section className="card-surface p-5" aria-label="Financial analysis">
        <SkeletonRows rows={5} />
      </section>
    );
  }
  if (error) {
    return (
      <section className="card-surface p-5" aria-label="Financial analysis">
        <ErrorState
          title="Could not load the analysis"
          message="The financial analysis could not be loaded — the database may be unavailable. Try again in a moment."
          onRetry={() => setReloadTick((t) => t + 1)}
        />
      </section>
    );
  }

  const isDraft = analysis?.status === "draft";
  const isApproved = analysis?.status === "approved";

  return (
    <section className="card-surface p-5" aria-label="Financial analysis">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
          Financial analysis
        </h2>
        {payload?.industry && <span className="text-xs text-caption">{payload.industry}</span>}
        {payload?.generatedAt && (
          <span className="text-xs text-caption">Generated {fmtDate(payload.generatedAt)}</span>
        )}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={running}
            onClick={() => void runAnalysis()}
            className="btn btn-primary btn-sm min-h-[44px]"
          >
            {running ? "Running…" : analysis ? "Re-run analysis" : "Run analysis"}
          </button>
        </span>
      </div>

      {actionMsg && (
        <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
          {actionMsg}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {actionError}
        </p>
      )}

      {!analysis || !payload ? (
        <EmptyState
          title="No analysis yet"
          message="The automated analysis computes ratios, integrity checks, anomalies, suggested QoE adjustments, working-capital pegs and a deal screen from the posted financial statements. It runs automatically when financials are posted — or run it now."
          actionLabel={running ? "Running…" : "Run analysis"}
          onAction={() => void runAnalysis()}
        />
      ) : (
        <>
          {/* Status / sign-off */}
          {isDraft && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
            >
              <span className="badge badge-warn mr-2">DRAFT</span>
              This analysis is a draft — it is not published and is not served to other
              modules until it is approved.
              <span className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs">
                  Sign-off: “Reviewed by ___ on ___ · Approved to publish”
                </span>
                <button
                  type="button"
                  disabled={approving}
                  onClick={() => void approveAnalysis()}
                  className="btn btn-primary btn-sm min-h-[44px]"
                >
                  {approving ? "Approving…" : "Approve to publish"}
                </button>
              </span>
            </div>
          )}
          {isApproved && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
              <span className="badge badge-fit">Published</span>
              <span>
                Reviewed by {analysis.reviewedBy ?? analysis.approvedBy ?? "—"} on{" "}
                {analysis.reviewedAt
                  ? fmtDate(analysis.reviewedAt)
                  : analysis.approvedAt
                    ? fmtDate(analysis.approvedAt)
                    : "—"}{" "}
                · Approved to publish
              </span>
            </div>
          )}

          {/* 1 — Ratio dashboard */}
          <div className="mt-2">
            <div className="mb-2 flex flex-wrap items-end gap-3">
              <SectionTitle>Ratio dashboard</SectionTitle>
              {(payload.metricsByPeriod ?? []).length > 1 && (
                <div className="ml-auto min-w-[200px] sm:max-w-xs">
                  <label className={labelCls} htmlFor="fa-ratio-period">Period</label>
                  <select
                    id="fa-ratio-period"
                    value={ratioMetrics?.setId ?? ""}
                    onChange={(e) => setRatioPeriod(e.target.value)}
                    className={`${inputCls} min-h-[44px]`}
                  >
                    {[...(payload.metricsByPeriod ?? [])].reverse().map((mp) => (
                      <option key={mp.setId} value={mp.setId}>
                        {mp.periodEnd ? fmtDate(mp.periodEnd) : "No period end"}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            {!ratioMetrics || ratioMetrics.metrics.length === 0 ? (
              <p className="text-sm text-caption">No ratio metrics for the selected period.</p>
            ) : (
              GROUP_ORDER.map((group) => {
                const rows = ratioMetrics.metrics.filter((m) => m.group === group);
                if (rows.length === 0) return null;
                return (
                  <div key={group} className="mb-4">
                    <p className="micro-label mb-1.5">{GROUP_LABELS[group]}</p>
                    <div className="overflow-x-auto">
                      <table className="tbl-grad w-full min-w-[760px] text-sm">
                        <thead>
                          <tr>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Metric</th>
                            <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Value</th>
                            <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Prior</th>
                            <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Δ %</th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Benchmark band</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((m) => {
                            const chip = confidenceChip(m.confidence);
                            return (
                              <tr
                                key={m.key}
                                className="border-t border-slate-100 align-top transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5"
                              >
                                <td className="px-3 py-2.5">
                                  <span className="font-medium text-[#0d1f3c] dark:text-white">{m.label}</span>
                                  <span
                                    className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}
                                    title="Confidence"
                                  >
                                    {chip.label}
                                  </span>
                                  <span className="mt-0.5 block text-xs italic text-caption">{m.formula}</span>
                                  {m.sourceLines.length > 0 && (
                                    <span className="block text-xs text-caption">
                                      Source lines: {m.sourceLines.join(", ")}
                                    </span>
                                  )}
                                  {m.note && <span className="block text-xs text-amber-700 dark:text-amber-300">{m.note}</span>}
                                </td>
                                <td className="tnum px-3 py-2.5 text-right font-medium text-[#0d1f3c] dark:text-white">
                                  {fmtMetric(m.value, m.unit)}
                                </td>
                                <td className="tnum px-3 py-2.5 text-right text-[#0d1f3c] dark:text-white">
                                  {fmtMetric(m.prior, m.unit)}
                                </td>
                                <td className="tnum px-3 py-2.5 text-right text-[#0d1f3c] dark:text-white">
                                  {fmtSignedFracPct(m.deltaPct)}
                                </td>
                                <td className="px-3 py-2.5">
                                  <BenchmarkBand metric={m} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 2 — Trend + anomalies */}
          <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/5">
            <SectionTitle>Trends &amp; anomalies</SectionTitle>
            {trendPoints.length === 0 ? (
              <p className="text-sm text-caption">No periods to trend yet.</p>
            ) : (
              <TrendChart
                points={trendPoints}
                anomalyPeriodEnds={(payload.anomalies ?? []).map((a) => a.periodEnd ?? "")}
              />
            )}
            {(payload.anomalies ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-caption">No anomalies flagged.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {(payload.anomalies ?? []).map((a, i) => (
                  <li key={`${a.rule}-${a.setId ?? ""}-${i}`} className="flex flex-wrap items-start gap-2 text-sm">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${severityChip(a.severity)}`}>
                      {a.severity}
                    </span>
                    <span className="min-w-0 flex-1 text-slate-700 dark:text-white/80">
                      <span className="font-medium text-[#0d1f3c] dark:text-white">{a.rule.replace(/_/g, " ")}</span>
                      {" — "}
                      {a.message}
                      {a.periodEnd && <span className="text-caption"> · {fmtDate(a.periodEnd)}</span>}
                      {Object.keys(a.figures ?? {}).length > 0 && (
                        <span className="tnum block text-xs text-caption">
                          {Object.entries(a.figures)
                            .map(([k, v]) => `${k.replace(/_/g, " ")}: ${fmtAnomalyFigure(k, v)}`)
                            .join(" · ")}
                        </span>
                      )}
                      {a.sourceLines.length > 0 && (
                        <span className="block text-xs text-caption">Source lines: {a.sourceLines.join(", ")}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {(payload.coverage ?? []).length > 0 && (
              <div className="mt-3">
                <p className="micro-label mb-1">Coverage notes</p>
                <ul className="space-y-1 text-sm text-caption">
                  {(payload.coverage ?? []).map((c, i) => (
                    <li key={`${c.rule}-${i}`}>
                      <span className="font-medium">{c.rule.replace(/_/g, " ")}</span>: {c.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* 3 + 12 — Margin bridge + adjustment log */}
          <div className="mt-6 grid gap-4 border-t border-slate-100 pt-4 dark:border-white/5 lg:grid-cols-2">
            <div className="min-w-0">
              <SectionTitle>Margin bridge (reported → adjusted EBITDA)</SectionTitle>
              {!payload.marginBridge ? (
                <p className="text-sm text-caption">
                  No margin bridge — accept a suggested adjustment below and the bridge appears
                  after the analysis re-runs.
                </p>
              ) : (
                <>
                  <MarginBridgeChart
                    bridge={{
                      reportedEbitda: payload.marginBridge.reportedEbitda,
                      items: payload.marginBridge.items,
                      adjustedEbitda: payload.marginBridge.adjustedEbitda,
                    }}
                  />
                  <dl className="mt-2 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-caption">Reported EBITDA</dt>
                      <dd className="tnum font-medium text-[#0d1f3c] dark:text-white">
                        {payload.marginBridge.reportedEbitda === null ? "—" : fmtMoney(payload.marginBridge.reportedEbitda)}
                      </dd>
                    </div>
                    {payload.marginBridge.items.map((item, i) => (
                      <div key={`${item.label}-${i}`} className="flex items-center justify-between gap-3">
                        <dt className="text-caption">{item.label}</dt>
                        <dd className="tnum font-medium text-[#0d1f3c] dark:text-white">{fmtMoney(item.amount)}</dd>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-1.5 dark:border-white/5">
                      <dt className="font-medium text-[#0d1f3c] dark:text-white">Adjusted EBITDA</dt>
                      <dd className="tnum font-semibold text-[#0d1f3c] dark:text-white">
                        {payload.marginBridge.adjustedEbitda === null ? "—" : fmtMoney(payload.marginBridge.adjustedEbitda)}
                      </dd>
                    </div>
                  </dl>
                  {payload.marginBridge.adjustedSetId && (
                    <p className="mt-1 text-xs text-caption">
                      Adjusted set:{" "}
                      <Link
                        href={`/financials/review/${encodeURIComponent(payload.marginBridge.adjustedSetId)}`}
                        className="font-semibold text-gold-700 hover:underline dark:text-gold-400"
                      >
                        Open the adjusted draft
                      </Link>
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="min-w-0">
              <SectionTitle>Adjustment log (suggested QoE adjustments)</SectionTitle>
              {adjustments.length === 0 ? (
                <p className="text-sm text-caption">No suggested adjustments for this company.</p>
              ) : (
                <ul className="space-y-3">
                  {adjustments.map((adj) => {
                    const inputs = adjInputs[adj.id] ?? { amount: "", inputValue: "" };
                    const docId =
                      typeof adj.source?.documentId === "string" ? adj.source.documentId : null;
                    const src = sourceText(adj.source ?? {});
                    const proposed = adj.status === "proposed";
                    return (
                      <li key={adj.id} className="rounded-xl border border-slate-100 px-3.5 py-3 dark:border-white/5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-[#0d1f3c] dark:text-white">{adj.label}</span>
                          <span className="badge badge-neutral">{adj.kind.replace(/_/g, " ")}</span>
                          <span
                            className={`badge ${adj.status === "accepted" ? "badge-fit" : adj.status === "rejected" ? "badge-danger" : "badge-warn"}`}
                          >
                            {adj.status}
                          </span>
                          <span className="tnum ml-auto text-sm font-medium text-[#0d1f3c] dark:text-white">
                            {adj.direction === "subtract" ? "−" : "+"}
                            {adj.amount === null
                              ? " amount TBD"
                              : fmtMoney(adj.amount)}
                            {adj.requiresInput ? ` · needs ${adj.requiresInput.replace(/_/g, " ")}` : ""}
                          </span>
                        </div>
                        {adj.rationale && (
                          <p className="mt-1 text-sm text-slate-700 dark:text-white/80">{adj.rationale}</p>
                        )}
                        {(src || docId) && (
                          <p className="mt-0.5 text-xs text-caption">
                            {src}
                            {docId && (
                              <>
                                {src ? " · " : ""}
                                <Link
                                  href={`/documents?doc=${encodeURIComponent(docId)}`}
                                  className="font-semibold text-gold-700 hover:underline dark:text-gold-400"
                                >
                                  View source
                                </Link>
                              </>
                            )}
                          </p>
                        )}
                        {!proposed && (
                          <p className="mt-1 text-xs text-caption">
                            Decided {adj.decidedAt ? fmtDate(adj.decidedAt) : ""}
                            {adj.decidedBy ? ` by ${adj.decidedBy}` : ""}
                            {adj.decidedAmount !== null && adj.decidedAmount !== undefined
                              ? ` · amount ${fmtMoney(adj.decidedAmount)}`
                              : ""}
                            {adj.adjustedSetId ? " · applied to the adjusted draft" : ""}
                          </p>
                        )}
                        {proposed && (
                          <div className="mt-2 space-y-2">
                            <div className="flex flex-wrap gap-2">
                              <div className="min-w-[140px] flex-1">
                                <label className={labelCls} htmlFor={`adj-amt-${adj.id}`}>
                                  Amount{adj.amount !== null ? " (override)" : ""}
                                </label>
                                <input
                                  id={`adj-amt-${adj.id}`}
                                  inputMode="decimal"
                                  value={inputs.amount}
                                  onChange={(e) =>
                                    setAdjInputs((prev) => ({
                                      ...prev,
                                      [adj.id]: { ...inputs, amount: e.target.value },
                                    }))
                                  }
                                  placeholder={adj.amount !== null ? fmtMoney(adj.amount) : "Required"}
                                  className={`${inputCls} min-h-[44px]`}
                                />
                              </div>
                              {adj.requiresInput && (
                                <div className="min-w-[140px] flex-1">
                                  <label className={labelCls} htmlFor={`adj-in-${adj.id}`}>
                                    {adj.requiresInput === "market_rent"
                                      ? "Market rent"
                                      : adj.requiresInput === "market_owner_comp"
                                        ? "Market owner comp"
                                        : adj.requiresInput.replace(/_/g, " ")}
                                  </label>
                                  <input
                                    id={`adj-in-${adj.id}`}
                                    inputMode="decimal"
                                    value={inputs.inputValue}
                                    onChange={(e) =>
                                      setAdjInputs((prev) => ({
                                        ...prev,
                                        [adj.id]: { ...inputs, inputValue: e.target.value },
                                      }))
                                    }
                                    placeholder="Market value"
                                    className={`${inputCls} min-h-[44px]`}
                                  />
                                </div>
                              )}
                            </div>
                            {adj.requiresInput && (
                              <p className="text-xs text-caption">
                                Accepting applies stated − market value as the adjustment amount
                                (or the Amount above when filled in).
                              </p>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={decidingId === adj.id}
                                onClick={() => void decide(adj, "accept")}
                                className="btn btn-primary btn-sm min-h-[44px]"
                              >
                                {decidingId === adj.id ? "Saving…" : "Accept"}
                              </button>
                              <button
                                type="button"
                                disabled={decidingId === adj.id}
                                onClick={() => void decide(adj, "reject")}
                                className="btn btn-secondary btn-sm min-h-[44px]"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* 4 + 10 — Working capital seasonality + peg */}
          <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/5">
            <SectionTitle>Working capital — seasonality &amp; peg</SectionTitle>
            {(payload.workingCapital?.points ?? []).length === 0 ? (
              <p className="text-sm text-caption">
                No working-capital points — periods are missing current assets, cash, current
                liabilities or current debt.
              </p>
            ) : (
              <>
                <WorkingCapitalChart
                  points={payload.workingCapital.points}
                  peg={payload.workingCapital.peg}
                />
                <div className="mt-2 grid gap-4 lg:grid-cols-2">
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-caption">Normalized WC % of revenue (median)</dt>
                      <dd className="tnum font-medium text-[#0d1f3c] dark:text-white">
                        {fmtFracPct(payload.workingCapital.normalizedWcPct)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-caption">Peg — low</dt>
                      <dd className="tnum font-medium text-[#0d1f3c] dark:text-white">
                        {payload.workingCapital.peg.low === null ? "—" : fmtMoney(payload.workingCapital.peg.low)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-caption">Peg — mid</dt>
                      <dd className="tnum font-medium text-[#0d1f3c] dark:text-white">
                        {payload.workingCapital.peg.mid === null ? "—" : fmtMoney(payload.workingCapital.peg.mid)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-caption">Peg — high</dt>
                      <dd className="tnum font-medium text-[#0d1f3c] dark:text-white">
                        {payload.workingCapital.peg.high === null ? "—" : fmtMoney(payload.workingCapital.peg.high)}
                      </dd>
                    </div>
                    {payload.workingCapital.peg.basis && (
                      <p className="pt-1 text-xs text-caption">Basis: {payload.workingCapital.peg.basis}</p>
                    )}
                    {(payload.workingCapital.points ?? []).some(
                      (p) => payload.periods.find((x) => x.setId === p.setId)?.periodType !== "monthly"
                    ) && (
                      <p className="text-xs text-caption">
                        Includes non-monthly periods — the peg band is most reliable with monthly
                        statements.
                      </p>
                    )}
                  </dl>
                  <div>
                    <p className="micro-label mb-1.5">Seasonality index by month (1.00 = average month)</p>
                    {(payload.workingCapital.seasonality ?? []).length === 0 ? (
                      <p className="text-sm text-caption">No monthly seasonality data.</p>
                    ) : (
                      <div className="space-y-1">
                        {(payload.workingCapital.seasonality ?? []).map((s) => (
                          <div key={s.month} className="flex items-center gap-2 text-xs">
                            <span className="w-8 shrink-0 text-caption">{MONTH_NAMES[s.month - 1] ?? s.month}</span>
                            <div className="h-3 min-w-0 flex-1 rounded bg-slate-100 dark:bg-white/5">
                              {s.index !== null && (
                                <div
                                  className="h-3 rounded bg-[#b8975a]"
                                  style={{ width: `${Math.min(100, Math.max(0, (s.index / 2) * 100))}%` }}
                                />
                              )}
                            </div>
                            <span className="tnum w-10 shrink-0 text-right text-[#0d1f3c] dark:text-white">
                              {s.index === null ? "—" : s.index.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 5 — Monthly revenue + EBITDA */}
          <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/5">
            <SectionTitle>Monthly revenue &amp; EBITDA</SectionTitle>
            {(payload.chartData?.monthly ?? []).length === 0 ? (
              <p className="text-sm text-caption">
                Monthly statements not provided — monthly charts and seasonality are unavailable
                (annual fallback: see Trends above).
              </p>
            ) : (
              <MonthlyChart data={payload.chartData.monthly} />
            )}
          </div>

          {/* 6 + 7 — BS composition + cash conversion */}
          <div className="mt-6 grid gap-4 border-t border-slate-100 pt-4 dark:border-white/5 lg:grid-cols-2">
            <div className="min-w-0 lg:col-span-2">
              <SectionTitle>Balance-sheet composition</SectionTitle>
              {(payload.chartData?.bsComposition ?? []).length === 0 ? (
                <p className="text-sm text-caption">No balance-sheet periods to compose.</p>
              ) : (
                <BsCompositionChart data={payload.chartData.bsComposition} />
              )}
            </div>
            <div className="min-w-0 lg:col-span-2">
              <SectionTitle>Cash conversion</SectionTitle>
              {!payload.chartData?.cashConversion ? (
                <p className="text-sm text-caption">
                  No cash-flow period available for the conversion waterfall.
                </p>
              ) : (
                <>
                  <CashConversionChart data={payload.chartData.cashConversion} />
                  <p className="mt-2 text-xs text-caption">
                    FCF = CFO + CFI, i.e. after all investing — no separate capex line exists in
                    the Phase 4 template, so capital expenditure cannot be split out here.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* 8 — Concentration + revenue quality */}
          <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/5">
            <SectionTitle>Revenue quality &amp; customer concentration</SectionTitle>
            <div className="grid gap-4 lg:grid-cols-2">
              <dl className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-caption">
                    Revenue{payload.revenueQuality.periodEnd ? ` · ${fmtDate(payload.revenueQuality.periodEnd)}` : ""}
                  </dt>
                  <dd className="tnum font-medium text-[#0d1f3c] dark:text-white">
                    {payload.revenueQuality.revenue === null ? "—" : fmtMoney(payload.revenueQuality.revenue)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-caption">Identified one-time revenue</dt>
                  <dd className="tnum font-medium text-[#0d1f3c] dark:text-white">
                    {payload.revenueQuality.identifiedOneTime === null ? "—" : fmtMoney(payload.revenueQuality.identifiedOneTime)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-caption">Identified recurring revenue</dt>
                  <dd className="tnum font-medium text-[#0d1f3c] dark:text-white">
                    {payload.revenueQuality.identifiedRecurring === null ? "—" : fmtMoney(payload.revenueQuality.identifiedRecurring)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-caption">Backlog</dt>
                  <dd className="tnum font-medium text-[#0d1f3c] dark:text-white">
                    {payload.revenueQuality.backlog.amount === null ? "— (not provided)" : fmtMoney(payload.revenueQuality.backlog.amount)}
                  </dd>
                </div>
                {payload.revenueQuality.concentration.available && (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-caption">Top customer share</dt>
                      <dd className="tnum font-medium text-[#0d1f3c] dark:text-white">
                        {payload.revenueQuality.concentration.top1Pct === null
                          ? "—"
                          : `${payload.revenueQuality.concentration.top1Pct.toFixed(1)}%`}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-caption">Top 5 share</dt>
                      <dd className="tnum font-medium text-[#0d1f3c] dark:text-white">
                        {payload.revenueQuality.concentration.top5Pct === null
                          ? "—"
                          : `${payload.revenueQuality.concentration.top5Pct.toFixed(1)}%`}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              <div className="min-w-0">
                {!payload.revenueQuality.concentration.available ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    Customer-level detail not provided — concentration cannot be computed. Upload
                    an AR aging or revenue-by-customer schedule to enable this panel.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {payload.revenueQuality.concentration.customers.map((cust) => (
                      <div key={cust.name} className="flex items-center gap-2 text-xs">
                        <span className="w-32 min-w-0 shrink-0 truncate text-slate-700 dark:text-white/80" title={cust.name}>
                          {cust.name}
                        </span>
                        <div className="h-3.5 min-w-0 flex-1 rounded bg-slate-100 dark:bg-white/5">
                          <div
                            className="h-3.5 rounded bg-[#0d1f3c] dark:bg-[#b8975a]"
                            style={{ width: `${Math.min(100, Math.max(0, cust.sharePct))}%` }}
                          />
                        </div>
                        <span className="tnum w-20 shrink-0 text-right text-[#0d1f3c] dark:text-white">
                          {cust.sharePct.toFixed(1)}% · {fmtMoneyCompact(cust.amount)}
                        </span>
                      </div>
                    ))}
                    <p className="text-xs text-caption">
                      Shares are percentages of the schedule total from the uploaded detail
                      schedule (the payload carries them as percentage points, unlike ratio
                      metrics, which are fractions).
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 9 — Deal screen */}
          <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/5">
            <SectionTitle>Deal screen</SectionTitle>
            {!dealScreen ? (
              <p className="text-sm text-caption">No deal screen in this analysis yet.</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-slate-700 dark:text-white/80">
                  EBITDA basis: <span className="font-medium text-[#0d1f3c] dark:text-white">{dealScreen.ebitdaBasis || dealScreen.basis}</span>
                  {" · "}EBITDA{" "}
                  <span className="tnum font-medium text-[#0d1f3c] dark:text-white">
                    {dealScreen.ebitda === null ? "—" : fmtMoney(dealScreen.ebitda)}
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {(
                    [
                      ["leverage", "Leverage (× EBITDA)"],
                      ["feesPct", "Fees (% of EV)"],
                      ["growthPct", "Growth (% / yr)"],
                      ["holdYears", "Hold (years)"],
                      ["paydownPct", "Debt paydown (%)"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key}>
                      <label className={labelCls} htmlFor={`ds-${key}`}>{label}</label>
                      <input
                        id={`ds-${key}`}
                        inputMode="decimal"
                        value={dsForm[key]}
                        onChange={(e) => setDsForm((prev) => ({ ...prev, [key]: e.target.value }))}
                        className={`${inputCls} min-h-[44px]`}
                      />
                    </div>
                  ))}
                  <div className="flex items-end">
                    <button
                      type="button"
                      disabled={dsBusy}
                      onClick={() => void recalcDealScreen()}
                      className="btn btn-primary min-h-[44px] w-full"
                    >
                      {dsBusy ? "Recalculating…" : "Recalculate"}
                    </button>
                  </div>
                </div>
                {dsError && <p className="mt-2 text-sm text-red-600 dark:text-red-300">{dsError}</p>}
                {dealScreen.assumptionsUsed && (
                  <p className="mt-2 text-xs text-caption">
                    Assumptions used: leverage {dealScreen.assumptionsUsed.leverageMultiple}× ·
                    fees {fmtFracPct(dealScreen.assumptionsUsed.feesPct)} · growth{" "}
                    {fmtFracPct(dealScreen.assumptionsUsed.growthPct)} · hold{" "}
                    {dealScreen.assumptionsUsed.holdYears} yrs · paydown{" "}
                    {fmtFracPct(dealScreen.assumptionsUsed.debtPaydownPct)}
                  </p>
                )}
                {(dealScreen.assumptionNotes ?? []).map((note) => (
                  <p key={note} className="mt-0.5 text-xs text-caption">{note}</p>
                ))}

                <div className="mt-3 overflow-x-auto">
                  <table className="tbl-grad w-full min-w-[860px] text-sm">
                    <thead>
                      <tr>
                        {["Entry ×", "Enterprise value", "Debt", "Fees", "Equity check", "Exit EBITDA", "Exit value", "Equity out", "MOIC", "IRR"].map((h) => (
                          <th key={h} className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide first:text-left">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(dealScreen.grid ?? []).map((row) => (
                        <tr key={row.entryMultiple} className="border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5">
                          <td className="tnum px-3 py-2.5 font-medium text-[#0d1f3c] dark:text-white">{row.entryMultiple.toFixed(1)}×</td>
                          <td className="tnum px-3 py-2.5 text-right text-[#0d1f3c] dark:text-white">{row.enterpriseValue === null ? "—" : fmtMoney(row.enterpriseValue)}</td>
                          <td className="tnum px-3 py-2.5 text-right text-[#0d1f3c] dark:text-white">{row.debt === null ? "—" : fmtMoney(row.debt)}</td>
                          <td className="tnum px-3 py-2.5 text-right text-[#0d1f3c] dark:text-white">{row.fees === null ? "—" : fmtMoney(row.fees)}</td>
                          <td className="tnum px-3 py-2.5 text-right font-medium text-[#0d1f3c] dark:text-white">{row.equityCheck === null ? "—" : fmtMoney(row.equityCheck)}</td>
                          <td className="tnum px-3 py-2.5 text-right text-[#0d1f3c] dark:text-white">{row.exitEbitda === null ? "—" : fmtMoney(row.exitEbitda)}</td>
                          <td className="tnum px-3 py-2.5 text-right text-[#0d1f3c] dark:text-white">{row.exitValue === null ? "—" : fmtMoney(row.exitValue)}</td>
                          <td className="tnum px-3 py-2.5 text-right text-[#0d1f3c] dark:text-white">{row.equityOut === null ? "—" : fmtMoney(row.equityOut)}</td>
                          <td className="tnum px-3 py-2.5 text-right font-medium text-[#0d1f3c] dark:text-white">{row.moic === null ? "—" : `${row.moic.toFixed(2)}×`}</td>
                          <td className="tnum px-3 py-2.5 text-right text-[#0d1f3c] dark:text-white">{fmtFracPct(row.irr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {sensitivityEntries.entries.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <p className="micro-label mb-1.5">Sensitivity — IRR by entry × exit multiple</p>
                    <table className="tbl-grad w-full min-w-[560px] text-sm">
                      <thead>
                        <tr>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Entry \ Exit</th>
                          {sensitivityEntries.exits.map((x) => (
                            <th key={x} className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">{x.toFixed(1)}×</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sensitivityEntries.entries.map((entry) => (
                          <tr key={entry} className="border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5">
                            <td className="tnum px-3 py-2.5 font-medium text-[#0d1f3c] dark:text-white">{entry.toFixed(1)}×</td>
                            {sensitivityEntries.exits.map((exit) => {
                              const cell = sensitivityEntries.cells.find(
                                (c) => c.entryMultiple === entry && c.exitMultiple === exit
                              );
                              return (
                                <td
                                  key={exit}
                                  className="tnum px-3 py-2.5 text-right text-[#0d1f3c] dark:text-white"
                                  title={cell?.moic !== null && cell?.moic !== undefined ? `MOIC ${cell.moic.toFixed(2)}×` : undefined}
                                >
                                  {fmtFracPct(cell?.irr)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-1 text-xs text-caption">Hover a cell for its MOIC.</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 11 — Integrity panel */}
          <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/5">
            <SectionTitle>Integrity checks</SectionTitle>
            <IntegrityPanel results={payload.integrity ?? []} />
          </div>

          {/* Benchmarks panel */}
          <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/5">
            <SectionTitle>Benchmarks</SectionTitle>
            {benchmarks.length === 0 ? (
              <p className="text-sm text-caption">
                No benchmarks stored yet — add one below or import a CSV. Ratio-dashboard bands
                appear once a benchmark matches the company&apos;s industry (or &quot;general&quot;).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl-grad w-full min-w-[640px] text-sm">
                  <thead>
                    <tr>
                      {["Industry", "Metric", "Median", "p25", "p75", "Sample", "Source", "Note"].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {benchmarks.map((b) => {
                      const thin = b.sampleSize === null || b.sampleSize < 10;
                      // Benchmarks for pct metrics are stored as fractions when < 1
                      // heuristic is unsafe — show raw values as stored.
                      const raw = (v: number | null) => (v === null ? "—" : String(v));
                      return (
                        <tr key={b.id} className="border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5">
                          <td className="px-3 py-2.5 text-[#0d1f3c] dark:text-white">{b.industry}</td>
                          <td className="px-3 py-2.5 text-[#0d1f3c] dark:text-white">{b.metricKey}</td>
                          <td className="tnum px-3 py-2.5 text-[#0d1f3c] dark:text-white">{raw(b.median)}</td>
                          <td className="tnum px-3 py-2.5 text-[#0d1f3c] dark:text-white">{raw(b.p25)}</td>
                          <td className="tnum px-3 py-2.5 text-[#0d1f3c] dark:text-white">{raw(b.p75)}</td>
                          <td className="tnum px-3 py-2.5 text-[#0d1f3c] dark:text-white">
                            {b.sampleSize === null ? "—" : b.sampleSize}
                            {thin && <span className="badge badge-warn ml-2">preliminary</span>}
                          </td>
                          <td className="px-3 py-2.5 text-[#0d1f3c] dark:text-white">{b.source}</td>
                          <td className="px-3 py-2.5 text-caption">{b.note || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="micro-label mb-1.5">Add / update a benchmark</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls} htmlFor="bench-industry">Industry</label>
                    <input id="bench-industry" value={benchForm.industry} onChange={(e) => setBenchForm((p) => ({ ...p, industry: e.target.value }))} placeholder={payload.industry || "general"} className={`${inputCls} min-h-[44px]`} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="bench-metric">Metric key</label>
                    <input id="bench-metric" value={benchForm.metricKey} onChange={(e) => setBenchForm((p) => ({ ...p, metricKey: e.target.value }))} placeholder="current_ratio" className={`${inputCls} min-h-[44px]`} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="bench-median">Median</label>
                    <input id="bench-median" inputMode="decimal" value={benchForm.median} onChange={(e) => setBenchForm((p) => ({ ...p, median: e.target.value }))} className={`${inputCls} min-h-[44px]`} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="bench-p25">p25</label>
                    <input id="bench-p25" inputMode="decimal" value={benchForm.p25} onChange={(e) => setBenchForm((p) => ({ ...p, p25: e.target.value }))} className={`${inputCls} min-h-[44px]`} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="bench-p75">p75</label>
                    <input id="bench-p75" inputMode="decimal" value={benchForm.p75} onChange={(e) => setBenchForm((p) => ({ ...p, p75: e.target.value }))} className={`${inputCls} min-h-[44px]`} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="bench-sample">Sample size</label>
                    <input id="bench-sample" inputMode="numeric" value={benchForm.sampleSize} onChange={(e) => setBenchForm((p) => ({ ...p, sampleSize: e.target.value }))} className={`${inputCls} min-h-[44px]`} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls} htmlFor="bench-note">Note</label>
                    <input id="bench-note" value={benchForm.note} onChange={(e) => setBenchForm((p) => ({ ...p, note: e.target.value }))} className={`${inputCls} min-h-[44px]`} />
                  </div>
                </div>
                <p className="mt-1 text-xs text-caption">
                  Values are stored in the metric&apos;s own units — fractions for % metrics
                  (0.25 = 25%), multiples for × metrics. Samples under 10 are flagged
                  preliminary.
                </p>
                <button type="button" disabled={benchBusy} onClick={() => void saveBenchmark()} className="btn btn-secondary mt-2 min-h-[44px]">
                  {benchBusy ? "Saving…" : "Save benchmark"}
                </button>
              </div>
              <div>
                <p className="micro-label mb-1.5">Import benchmarks (CSV)</p>
                <label className={labelCls} htmlFor="bench-csv">CSV — header: industry,metric_key,median,p25,p75,sample_size,note</label>
                <textarea
                  id="bench-csv"
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  rows={7}
                  placeholder={"industry,metric_key,median,p25,p75,sample_size,note\ngeneral,current_ratio,1.8,1.2,2.6,42,2025 survey"}
                  className={inputCls}
                />
                <button type="button" disabled={csvBusy} onClick={() => void importBenchmarks()} className="btn btn-secondary mt-2 min-h-[44px]">
                  {csvBusy ? "Importing…" : "Import CSV"}
                </button>
              </div>
            </div>
            {benchMsg && <p className="mt-2 text-sm text-slate-700 dark:text-white/80">{benchMsg}</p>}
          </div>

          {/* Missing inputs */}
          <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/5">
            <SectionTitle>Missing inputs</SectionTitle>
            {missingInputs.length === 0 ? (
              <p className="text-sm text-caption">Nothing missing — every input the engine looks for was provided.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-white/80">
                {missingInputs.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
