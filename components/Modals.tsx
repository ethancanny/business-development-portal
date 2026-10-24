"use client";

import { useEffect, useRef, useState } from "react";
import { EARLY_STAGE_STAGES, EXEC_STAGES, INVESTMENT_TYPE_LABELS, PARTNER_NAMES, PLATFORM_LBO_STAGES, stageForTypeChange, type Deal, type DealDrivers, type Executive, type InvestmentTypeKey, type MiMultiple } from "@/lib/types";
import {
  TypeBadge,
  applicableDefs,
  fetchBdBootstrap,
  fmtMetricValue,
  metricRawValue,
  stagesForType,
  type BdBootstrap,
} from "@/components/InvestmentTypeBits";
import { fmtMoney, fmtDate, uniqueStrings, dedupeSourceTokens } from "@/lib/format";
import { DRIVER_DEFS, VALUATION_BANDS, VALUATION_GROUPS, bandForDeal, dealFocusSector, estimateMultiple, matchGroup, resolveDealValue, resolveStatedPrice, resolveStructure, type MarketRates, type MultipleEstimate } from "@/lib/valuation";
import SectorChip, { StageChip } from "@/components/SectorChip";
import DealRecordHeader from "@/components/DealRecordHeader";
import DealForm from "@/components/DealForm";
import ConfirmDealDialog from "@/components/identity/ConfirmDealDialog";

function fmtMultRange(lo: number, hi: number): string {
  return lo.toFixed(1) === hi.toFixed(1)
    ? `${lo.toFixed(1)}×`
    : `${lo.toFixed(1)}–${hi.toFixed(1)}×`;
}

function fmtMoneyRange(lo: number | null, hi: number | null): string {
  if (lo === null || hi === null) return "";
  return Math.round(lo) === Math.round(hi)
    ? fmtMoney(Math.round(lo))
    : `${fmtMoney(Math.round(lo))} – ${fmtMoney(Math.round(hi))}`;
}

function MultBubble({
  step,
  title,
  caption,
  value,
  sub,
  dot,
  emphasize,
}: {
  step: string;
  title: string;
  caption: string;
  value: string;
  sub?: string;
  dot: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`mult-bubble rounded-2xl border px-4 py-3 ${
        emphasize
          ? "border-[#b8975a]/70 bg-[#b8975a]/10 ring-1 ring-inset ring-[#b8975a]/50 dark:bg-[#b8975a]/10"
          : "border-slate-200 bg-white dark:border-white/10 dark:bg-white/5"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-white/40">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} />
            {step}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
          <p className="text-xs text-slate-500 dark:text-white/50">{caption}</p>
        </div>
        <span className={`shrink-0 text-2xl font-bold leading-none ${emphasize ? "text-[#8a6f3c] dark:text-[#d4b37a]" : "text-slate-900 dark:text-white"}`}>
          {value}
        </span>
      </div>
      {sub && <p className="mt-1.5 text-xs text-slate-500 dark:text-white/50">{sub}</p>}
    </div>
  );
}

/** Read-only rendering of a rough multiple estimate: each multiple in
 * the chain gets its own bubble row — the unadjusted market base, the
 * market multiple after drivers & growth, the market's effective
 * estimate at the usual structure, then this deal's actual headline
 * (stated price ÷ EBITDA) and actual effective after discounting its
 * structure. Used in the deal modal's view and edit modes; edit mode
 * recomputes it live. */
export function EstimateBody({ est }: { est: MultipleEstimate }) {
  const headlineVerdict = !est.headlineLocked
    ? "No price recorded — the headline is shown at the market multiple."
    : Math.abs(est.gapHeadlineX) < 0.05
      ? "The ask sits right at the market multiple."
      : `Headline sits ${est.gapHeadlineX > 0 ? "+" : "−"}${Math.abs(est.gapHeadlineX).toFixed(2)}× ${est.gapHeadlineX > 0 ? "above" : "below"} the market multiple.`;
  const effectiveVerdict =
    Math.abs(est.gapEffectiveX) < 0.05
      ? "Effective pricing matches the market's effective pricing."
      : `Effective sits ${est.gapEffectiveX > 0 ? "+" : "−"}${Math.abs(est.gapEffectiveX).toFixed(2)}× ${est.gapEffectiveX > 0 ? "above" : "below"} the market's effective pricing${est.gapEffectiveDollars !== null ? ` — about ${fmtMoney(Math.abs(Math.round(est.gapEffectiveDollars)))} ${est.gapEffectiveX > 0 ? "more" : "less"} on this ${est.lens === "Revenue" ? "revenue" : "EBITDA"}` : ""}.`;
  const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}×`;
  const headlineMid = (est.headlineLow + est.headlineHigh) / 2;
  return (
    <div className="text-sm">
      {/* Three-line summary (Oct 14, 2026): headline vs market,
          effective vs market, largest driver — always visible; the
          full narrative lives behind Details in the synthesis panel. */}
      <div className="mb-2 rounded-2xl border border-[#b8975a]/40 bg-[#b8975a]/5 px-4 py-3 dark:bg-[#b8975a]/10">
        <p className="text-[13px] font-medium text-slate-800 dark:text-[#e8dfc8]">
          {est.headlineLocked ? (
            <>
              Headline <strong>{headlineMid.toFixed(2)}×</strong> vs market{" "}
              <strong>{est.marketMid.toFixed(2)}×</strong> ({signed(est.gapHeadlineX)})
            </>
          ) : (
            <>
              Headline — no stated price; shown at the market multiple{" "}
              <strong>{est.marketMid.toFixed(2)}×</strong>
            </>
          )}
        </p>
        <p className="mt-0.5 text-[13px] font-medium text-slate-800 dark:text-[#e8dfc8]">
          Effective <strong>{est.effMid.toFixed(2)}×</strong> vs market estimate{" "}
          <strong>{est.estimateEffMid.toFixed(2)}×</strong> ({signed(est.gapEffectiveX)}
          {est.gapEffectiveDollars !== null
            ? ` ≈ ${fmtMoney(Math.abs(Math.round(est.gapEffectiveDollars)))} ${est.gapEffectiveX > 0 ? "over" : "under"}`
            : ""})
        </p>
        <p className="mt-0.5 text-[13px] font-medium text-slate-800 dark:text-[#e8dfc8]">
          {est.largestDriver ? (
            <>
              Largest driver: {est.largestDriver.label}{" "}
              <strong>{signed(est.largestDriver.adj)}</strong>
            </>
          ) : (
            <>Largest driver: none recorded</>
          )}
          <span className="ml-2 text-xs font-normal text-slate-400 dark:text-white/40">
            Lens: {est.lens} multiple
          </span>
        </p>
      </div>
      <div className="space-y-2">
        <MultBubble
          step="Market"
          title="Market — unadjusted"
          caption={est.baseSource}
          value={`${est.base.toFixed(2)}×`}
          sub={`${est.baseIsBlend ? "⚠ All-industry blend — no published median for this industry in the band. " : ""}Backed by ${est.compSupport} published/logged comps · confidence ${est.confidence}`}
          dot="bg-slate-400"
        />
        <MultBubble
          step="Market multiple"
          title="Market multiple — after drivers & growth"
          caption="The headline multiple the market would price this business at"
          value={fmtMultRange(est.cashEqLow, est.cashEqHigh)}
          sub={`Point estimate ${est.marketMid.toFixed(1)}× · confidence ${est.confidence}${est.evLow !== null && est.evHigh !== null ? ` · ≈ ${fmtMoneyRange(est.evLow, est.evHigh)}` : ""}`}
          dot="bg-[#b8975a]"
          emphasize
        />
        <MultBubble
          step="Market estimate"
          title="Market estimate — effective"
          caption={`Market multiple × usual structure ${est.typicalFactor.toFixed(2)}`}
          value={`${est.estimateEffMid.toFixed(2)}×`}
          sub={`Range ${fmtMultRange(est.estimateEffLow, est.estimateEffHigh)}`}
          dot="bg-sky-400"
        />
        <MultBubble
          step="This deal"
          title="Actual headline"
          caption={est.headlineSource}
          value={fmtMultRange(est.headlineLow, est.headlineHigh)}
          sub={est.statedEvLow !== null && est.statedEvHigh !== null ? `Stated price ≈ ${fmtMoneyRange(est.statedEvLow, est.statedEvHigh)}` : undefined}
          dot="bg-amber-400"
        />
        <MultBubble
          step="This deal"
          title="Actual effective"
          caption={`Headline × ${est.structureFactor.toFixed(2)} structure value`}
          value={fmtMultRange(est.effLow, est.effHigh)}
          sub={est.effEvLow !== null && est.effEvHigh !== null ? `Effective value ≈ ${fmtMoneyRange(est.effEvLow, est.effEvHigh)}` : undefined}
          dot="bg-emerald-400"
        />
        <div className="mult-bubble rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/10 dark:bg-white/5">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-white/40">Reconciliation</p>
          <p className={`mt-1 text-xs font-medium ${!est.headlineLocked || Math.abs(est.gapHeadlineX) < 0.05 ? "text-slate-500 dark:text-white/50" : est.gapHeadlineX > 0 ? "text-amber-600 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-300"}`}>
            {headlineVerdict}
          </p>
          <p className={`mt-0.5 text-xs font-medium ${Math.abs(est.gapEffectiveX) < 0.05 ? "text-slate-500 dark:text-white/50" : est.gapEffectiveX > 0 ? "text-amber-600 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-300"}`}>
            {effectiveVerdict}
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-1">
        <p className="text-xs text-slate-400 dark:text-white/40">
          Base {est.base.toFixed(2)}× — {est.baseBasis}
        </p>
        {est.driverNotes.map((n, i) => (
          <p key={i} className="text-xs text-slate-500 dark:text-white/50">{n}</p>
        ))}
        {est.growthNote && (
          <p className="text-xs font-medium text-slate-600 dark:text-[#c8bfa8]">{est.growthNote}</p>
        )}
        {est.pieceNotes.map((n, i) => (
          <p key={`pn-${i}`} className="text-xs text-slate-500 dark:text-white/50">{n}</p>
        ))}
        <p className="text-xs text-slate-400 dark:text-white/40">
          Structure{est.structureAssumed ? " (industry-typical, assumed)" : ""}: {est.structure.cash}% cash ·{" "}
          {est.structure.seller}% seller note · {est.structure.earnout}% earnout · {est.structure.rollover}% rollover
          → each stated dollar is worth ~{(est.structureFactor * 100).toFixed(0)}¢ after expected payout + time value
          (note {(est.pieces.seller * 100).toFixed(0)}¢{est.sbaPct !== null ? ` at SBA ${est.sbaPct.toFixed(2)}%` : ""} ·
          earnout {(est.pieces.earnout * 100).toFixed(0)}¢ · rollover {(est.pieces.rollover * 100).toFixed(0)}¢),
          so the effective multiple sits ~{((1 - est.structureFactor) * 100).toFixed(0)}% below the headline.
        </p>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8] dark:placeholder:text-white/30";
const labelCls = "mb-1 block text-xs font-medium text-slate-600 dark:text-[#c8bfa8]";

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Initial focus lands on the dialog panel; Escape closes. Mount-only
  // (latest onClose via ref) so form re-renders never steal focus.
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 dark:bg-black/60"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl focus:outline-none dark:border-white/10 dark:bg-[#132847] dark:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="py-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-white/40">
        {label}
      </p>
      <p className="mt-0.5 text-sm text-slate-800 dark:text-[#e8dfc8]">{value || "—"}</p>
    </div>
  );
}

/** Comp log prompt (Oct 14, 2026): when a deal is passed or reaches a
 * closing stage, offer to log it as a comp. The row lands in
 * mi_multiples as sourceReport "Canny Comp Log"; once a group + size
 * band has ≥5 entries, the valuation engine blends their median into
 * the base multiple for that group/band. */
export function CompLogSection({ deal, onLogged }: { deal: Deal; onLogged: () => void }) {
  const now = new Date();
  const group0 = matchGroup(deal.industry) ?? deal.industry;
  const stated = resolveStatedPrice(deal);
  const { mix, amountsTotal } = resolveStructure(deal, matchGroup(deal.industry));
  const structure0 =
    `${mix.cash}% cash · ${mix.seller}% seller note · ${mix.earnout}% earnout · ${mix.rollover}% rollover` +
    (amountsTotal ? ` (stated ${fmtMoney(amountsTotal)})` : "");
  const [industry, setIndustry] = useState(group0);
  const [sizeBand, setSizeBand] = useState(bandForDeal(deal));
  const [period, setPeriod] = useState(`${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`);
  const [price, setPrice] = useState(stated ? String(Math.round(stated)) : "");
  const [revenue, setRevenue] = useState(deal.revenue ? String(deal.revenue) : "");
  const [ebitda, setEbitda] = useState(deal.ebitda ? String(deal.ebitda) : "");
  const [structure, setStructure] = useState(structure0);
  const [source, setSource] = useState(`Canny comp log — ${deal.companyName} (${deal.stage})`);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const priceN = Number(price) || 0;
  const revN = Number(revenue) || 0;
  const ebitdaN = Number(ebitda) || 0;
  const evEbitda = priceN > 0 && ebitdaN > 0 ? priceN / ebitdaN : null;
  const evRevenue = priceN > 0 && revN > 0 ? priceN / revN : null;

  const save = async () => {
    setBusy(true);
    setErr("");
    const notes =
      `Comp: ${deal.companyName} (${deal.stage}) · Revenue ${revN ? fmtMoney(revN) : "—"} · ` +
      `EBITDA ${ebitdaN ? fmtMoney(ebitdaN) : "—"} · Price ${priceN ? fmtMoney(priceN) : "—"} · ` +
      `Structure: ${structure} · Source: ${source}`;
    const res = await fetch("/api/market/multiples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceReport: "Canny Comp Log",
        period,
        industry,
        sizeBand,
        evEbitdaLow: null,
        evEbitdaHigh: null,
        evEbitdaMedian: evEbitda ? Math.round(evEbitda * 100) / 100 : null,
        evRevenueMedian: evRevenue ? Math.round(evRevenue * 100) / 100 : null,
        notes,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      onLogged();
    } else {
      setErr("Could not save the comp — try again.");
    }
  };

  const groups = VALUATION_GROUPS.includes(industry) ? VALUATION_GROUPS : [industry, ...VALUATION_GROUPS];

  return (
    <div className="rounded-xl border border-[#b8975a]/50 bg-[#b8975a]/5 p-3 dark:bg-[#b8975a]/10">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">
        📒 Log this deal as a comp
      </p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-white/50">
        {deal.companyName} is {deal.stage === "Passed" ? "passed" : "at a closing stage"}. Logging it
        feeds the base multiple for its sector and size band once the log has 5+ entries there.
      </p>
      {done ? (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          ✓ Logged to the Canny Comp Log ({industry}, {sizeBand}).
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Sector / industry group">
              <select className={inputCls} value={industry} onChange={(e) => setIndustry(e.target.value)}>
                {groups.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </Field>
            <Field label="Size band">
              <select className={inputCls} value={sizeBand} onChange={(e) => setSizeBand(e.target.value)}>
                {VALUATION_BANDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Price (USD)">
              <input type="number" min="0" className={inputCls} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="—" />
            </Field>
            <Field label="Revenue (USD)">
              <input type="number" min="0" className={inputCls} value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="—" />
            </Field>
            <Field label="EBITDA (USD)">
              <input type="number" min="0" className={inputCls} value={ebitda} onChange={(e) => setEbitda(e.target.value)} placeholder="—" />
            </Field>
          </div>
          <p className="text-xs text-slate-500 dark:text-white/50">
            {evEbitda !== null && <>EV/EBITDA <strong>{evEbitda.toFixed(2)}×</strong></>}
            {evEbitda !== null && evRevenue !== null && " · "}
            {evRevenue !== null && <>EV/Revenue <strong>{evRevenue.toFixed(2)}×</strong></>}
            {evEbitda === null && evRevenue === null && "Enter a price plus revenue or EBITDA to compute the comp multiples."}
          </p>
          <Field label="Structure">
            <input className={inputCls} value={structure} onChange={(e) => setStructure(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Source">
              <input className={inputCls} value={source} onChange={(e) => setSource(e.target.value)} />
            </Field>
            <Field label="Period">
              <input className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value)} />
            </Field>
          </div>
          {err && <p className="text-xs font-medium text-red-600 dark:text-red-300">{err}</p>}
          <button
            onClick={save}
            disabled={busy || !industry || !sizeBand || !period}
            className="btn btn-primary self-start"
          >
            {busy ? "Saving…" : "Save comp"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------- Deal modal ----------------

function DupeWarning({
  deal,
  allDeals,
  name,
}: {
  deal: Deal | null;
  allDeals: Deal[];
  name: string;
}) {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const q = norm(name);
  if (q.length <= 2) return null;
  const dupe = allDeals.find(
    (d) =>
      d.id !== deal?.id &&
      (norm(d.companyName) === q ||
        norm(d.companyName).includes(q) ||
        q.includes(norm(d.companyName)))
  );
  if (!dupe) return null;
  return (
    <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
      Possible duplicate: &ldquo;{dupe.companyName}&rdquo; is already in the
      pipeline ({dupe.stage}).
    </p>
  );
}

interface DealModalProps {
  deal: Deal | null; // null = create new
  executives?: Executive[];
  allDeals?: Deal[];
  /** Pipeline's active type chip — preselected in the New
   * investment form for a new deal (Oct 24, 2026). */
  initialType?: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export function DealModal({ deal, executives = [], allDeals = [], initialType, onClose, onSaved, onDeleted }: DealModalProps) {
  const isNew = !deal;
  const [editing, setEditing] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    companyName: deal?.companyName ?? "",
    industry: deal?.industry ?? "",
    stage: deal?.stage ?? ("Sourced" as Deal["stage"]),
    investmentType: (deal?.investmentType ?? "platform_lbo") as InvestmentTypeKey,
    parentDealId: deal?.parentDealId ?? "",
    sourcedFromType: deal?.sourcedFromType ?? "",
    sourcedFromId: deal?.sourcedFromId ?? "",
    dealValue: deal?.dealValue?.toString() ?? "",
    contactName: deal?.contactName ?? "",
    contactEmail: deal?.contactEmail ?? "",
    notes: deal?.notes ?? "",
    owner: deal?.owner ?? "",
    city: deal?.city ?? "",
    operatorIds: deal?.operatorIds ?? [],
    revenue: deal?.revenue != null ? String(deal.revenue) : "",
    ebitda: deal?.ebitda != null ? String(deal.ebitda) : "",
    askingPrice: deal?.askingPrice != null ? String(deal.askingPrice) : "",
    growthPct: deal?.growthPct != null ? String(deal.growthPct) : "",
    topCustomerPct: deal?.metrics?.topCustomerPct != null ? String(deal.metrics.topCustomerPct) : "",
    top3Pct: deal?.metrics?.top3Pct != null ? String(deal.metrics.top3Pct) : "",
    recurringPct: deal?.metrics?.recurringPct != null ? String(deal.metrics.recurringPct) : "",
    ownerHoursPerWeek: deal?.metrics?.ownerHoursPerWeek != null ? String(deal.metrics.ownerHoursPerWeek) : "",
    broker: deal?.broker ?? "",
    source: deal?.source ?? "",
    passReason: deal?.passReason ?? "",
    links: (deal?.links ?? [])
      .map((l) => ({ label: l.label ?? "", url: l.url ?? "" }))
      .concat([{ label: "", url: "" }]),
    drivers: { ...(deal?.drivers ?? {}) } as DealDrivers,
    cashAmt: deal?.structure?.cashAmt != null ? String(deal.structure.cashAmt) : "",
    sellerAmt: deal?.structure?.sellerAmt != null ? String(deal.structure.sellerAmt) : "",
    earnoutAmt: deal?.structure?.earnoutAmt != null ? String(deal.structure.earnoutAmt) : "",
    rolloverAmt: deal?.structure?.rolloverAmt != null ? String(deal.structure.rolloverAmt) : "",
    sellerRatePct: deal?.structure?.sellerRatePct != null ? String(deal.structure.sellerRatePct) : "",
    sellerTermYrs: deal?.structure?.sellerTermYrs != null ? String(deal.structure.sellerTermYrs) : "",
    earnoutMetric: deal?.structure?.earnoutMetric ?? "",
    earnoutPeriodYrs: deal?.structure?.earnoutPeriodYrs != null ? String(deal.structure.earnoutPeriodYrs) : "",
    earnoutProbPct: deal?.structure?.earnoutProbPct != null ? String(deal.structure.earnoutProbPct) : "",
    rolloverVestYrs: deal?.structure?.rolloverVestYrs != null ? String(deal.structure.rolloverVestYrs) : "",
    rolloverProbPct: deal?.structure?.rolloverProbPct != null ? String(deal.structure.rolloverProbPct) : "",
  });

  const setLink = (i: number, k: "label" | "url", v: string) =>
    setForm((f) => ({
      ...f,
      links: f.links.map((l, j) => (j === i ? { ...l, [k]: v } : l)),
    }));

  const addLinkRow = () =>
    setForm((f) => ({ ...f, links: [...f.links, { label: "", url: "" }] }));

  const removeLinkRow = (i: number) =>
    setForm((f) => ({ ...f, links: f.links.filter((_, j) => j !== i) }));

  const toggleOperator = (id: string) =>
    setForm((f) => ({
      ...f,
      operatorIds: f.operatorIds.includes(id)
        ? f.operatorIds.filter((x) => x !== id)
        : [...f.operatorIds, id],
    }));

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Valuation estimate: multiples come from Market Intel; the estimate
  // recomputes live as financials, drivers and structure are recorded.
  const [multiples, setMultiples] = useState<MiMultiple[]>([]);
  const [rates, setRates] = useState<MarketRates>({});
  const [showSynthesis, setShowSynthesis] = useState(false);
  const loadMultiples = () => {
    fetch("/api/market/multiples")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMultiples(Array.isArray(d) ? d : []))
      .catch(() => {});
    fetch("/api/market/rates")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRates({ prime: d?.prime?.value ?? null, sba: d?.sba?.value ?? null }))
      .catch(() => {});
  };
  useEffect(() => {
    loadMultiples();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Investment Types (Step 1): bd config + this deal's structured
  // metrics. Seeded once when the bootstrap lands; saved alongside
  // the deal via the deal-metrics endpoint.
  const [bd, setBd] = useState<BdBootstrap | null>(null);
  const [metricForm, setMetricForm] = useState<Record<string, string>>({});
  const metricsSeeded = useRef(false);
  useEffect(() => {
    void fetchBdBootstrap().then((b) => {
      setBd(b);
      if (b && deal && !metricsSeeded.current) {
        metricsSeeded.current = true;
        const existing = b.metricsByDeal[deal.id] ?? {};
        const seed: Record<string, string> = {};
        for (const def of b.config.definitions) {
          seed[def.key] = metricRawValue(def, existing[def.key]);
        }
        setMetricForm(seed);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const stageOptionsFor = (typeKey: string): string[] => {
    const fromCfg = bd ? stagesForType(bd.config, typeKey) : [];
    if (fromCfg.length) return fromCfg;
    return typeKey === "early_stage"
      ? [...EARLY_STAGE_STAGES]
      : [...PLATFORM_LBO_STAGES];
  };
  const onTypeChange = (next: InvestmentTypeKey) => {
    setForm((f) => ({
      ...f,
      investmentType: next,
      stage: stageForTypeChange(f.stage, stageOptionsFor(next)),
    }));
  };
  /** Old-type fields with values that the new type will hide. */
  const hiddenOnTypeChange: string[] = (() => {
    if (isNew || !bd || !deal) return [];
    const oldType = (deal.investmentType ?? "platform_lbo") as InvestmentTypeKey;
    if (form.investmentType === oldType) return [];
    const newKeys = new Set(
      applicableDefs(bd.config, form.investmentType, form.industry).map((d) => d.key)
    );
    return applicableDefs(bd.config, oldType, form.industry)
      .filter((d) => !newKeys.has(d.key))
      .filter((d) => {
        const v = metricForm[d.key];
        return v !== undefined && v.trim() !== "";
      })
      .map((d) => d.label);
  })();

  const setDriver = (key: keyof DealDrivers, v: string) =>
    setForm((f) => ({ ...f, drivers: { ...f.drivers, [key]: v as DealDrivers[typeof key] } }));

  const structureFromForm = () => ({
    cashAmt: form.cashAmt.trim() === "" ? null : Number(form.cashAmt),
    sellerAmt: form.sellerAmt.trim() === "" ? null : Number(form.sellerAmt),
    earnoutAmt: form.earnoutAmt.trim() === "" ? null : Number(form.earnoutAmt),
    rolloverAmt: form.rolloverAmt.trim() === "" ? null : Number(form.rolloverAmt),
    sellerRatePct: form.sellerRatePct.trim() === "" ? null : Number(form.sellerRatePct),
    sellerTermYrs: form.sellerTermYrs.trim() === "" ? null : Number(form.sellerTermYrs),
    earnoutMetric: form.earnoutMetric || undefined,
    earnoutPeriodYrs: form.earnoutPeriodYrs.trim() === "" ? null : Number(form.earnoutPeriodYrs),
    earnoutProbPct: form.earnoutProbPct.trim() === "" ? null : Number(form.earnoutProbPct),
    rolloverVestYrs: form.rolloverVestYrs.trim() === "" ? null : Number(form.rolloverVestYrs),
    rolloverProbPct: form.rolloverProbPct.trim() === "" ? null : Number(form.rolloverProbPct),
    // Preserve any percent-based structure already on record.
    cashPct: deal?.structure?.cashPct ?? null,
    sellerPct: deal?.structure?.sellerPct ?? null,
    earnoutPct: deal?.structure?.earnoutPct ?? null,
    rolloverPct: deal?.structure?.rolloverPct ?? null,
  });

  const metricsFromForm = () => ({
    topCustomerPct: form.topCustomerPct.trim() === "" ? null : Number(form.topCustomerPct),
    top3Pct: form.top3Pct.trim() === "" ? null : Number(form.top3Pct),
    recurringPct: form.recurringPct.trim() === "" ? null : Number(form.recurringPct),
    ownerHoursPerWeek: form.ownerHoursPerWeek.trim() === "" ? null : Number(form.ownerHoursPerWeek),
  });

  const formDeal: Deal = {
    id: deal?.id ?? "new",
    companyName: form.companyName,
    industry: form.industry,
    stage: form.stage,
    investmentType: form.investmentType,
    parentDealId: form.parentDealId || null,
    sourcedFromType: (form.sourcedFromType || null) as Deal["sourcedFromType"],
    sourcedFromId: form.sourcedFromId || null,
    dealValue: Number(form.dealValue) || 0,
    revenue: form.revenue.trim() === "" ? null : Number(form.revenue) || null,
    ebitda: form.ebitda.trim() === "" ? null : Number(form.ebitda) || null,
    askingPrice: form.askingPrice.trim() === "" ? null : Number(form.askingPrice) || null,
    growthPct: form.growthPct.trim() === "" ? null : Number(form.growthPct),
    broker: form.broker,
    source: form.source,
    passReason: form.passReason,
    contactName: "",
    contactEmail: "",
    notes: "",
    owner: form.owner,
    city: form.city,
    lat: null,
    lng: null,
    links: [],
    operatorIds: form.operatorIds,
    drivers: form.drivers,
    structure: structureFromForm(),
    metrics: metricsFromForm(),
    createdAt: deal?.createdAt ?? "",
    updatedAt: deal?.updatedAt ?? "",
  };
  const est = estimateMultiple(formDeal, multiples, rates);
  const viewEst = deal ? estimateMultiple(deal, multiples, rates) : null;

  const save = async () => {
    if (!form.companyName.trim()) {
      setError("Company name is required");
      return;
    }
    setBusy(true);
    setError("");
    if (form.investmentType === "add_on" && !form.parentDealId) {
      setError("Add-on deals require a parent platform deal — pick one below.");
      return;
    }
    const payload = {
      ...form,
      investmentType: form.investmentType,
      parentDealId: form.parentDealId || null,
      sourcedFromType: form.sourcedFromType || null,
      sourcedFromId: form.sourcedFromId || null,
      dealValue: Number(form.dealValue) || 0,
      links: form.links.filter((l) => l.url.trim() !== ""),
      operatorIds: form.operatorIds,
      revenue: form.revenue.trim() === "" ? null : Number(form.revenue) || null,
      ebitda: form.ebitda.trim() === "" ? null : Number(form.ebitda) || null,
      askingPrice:
        form.askingPrice.trim() === "" ? null : Number(form.askingPrice) || null,
      growthPct: form.growthPct.trim() === "" ? null : Number(form.growthPct),
      drivers: form.drivers,
      structure: structureFromForm(),
      metrics: metricsFromForm(),
    };
    let res = await fetch(isNew ? "/api/deals" : `/api/deals/${deal!.id}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // Phase 10 stage gates: a blocked stage change names the unmet
    // conditions; the user may override with a reason (the override is
    // audit-logged server-side) or cancel and fix the conditions.
    if (res.status === 409) {
      const d = await res.json().catch(() => ({}));
      if (d.error === "stage_gate_blocked") {
        const list = (Array.isArray(d.unmet) ? d.unmet : [])
          .map((u: { label?: string }) => `• ${u.label ?? ""}`)
          .join("\n");
        const reason = window.prompt(
          `This stage change is blocked — unmet conditions:\n${list}\n\nEnter a reason to override (recorded in the audit trail), or cancel:`,
          ""
        );
        if (reason && reason.trim()) {
          setBusy(true);
          res = await fetch(`/api/deals/${deal!.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...payload,
              gateOverride: { reason: reason.trim() },
            }),
          });
        }
      }
    }
    setBusy(false);
    if (res.ok) {
      // Structured type/sector metrics ride along (Step 1). The deal
      // itself is already saved; a metrics failure is reported but
      // does not pretend the deal save failed.
      let savedId = deal?.id ?? null;
      if (isNew) {
        const created = (await res
          .clone()
          .json()
          .catch(() => null)) as { id?: string } | null;
        savedId = created?.id ?? null;
      }
      if (savedId && bd) {
        const defs = applicableDefs(
          bd.config,
          form.investmentType,
          form.industry
        );
        const entries = defs.map((d) => ({
          key: d.key,
          raw: metricForm[d.key] ?? "",
        }));
        const mres = await fetch(
          "/api/platform/investment-types/deal-metrics",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dealId: savedId, entries }),
          }
        );
        if (!mres.ok) {
          const md = await mres.json().catch(() => ({}));
          setError(
            `Deal saved, but its type metrics failed: ${md.error ?? mres.status}. Reopen and save again to retry.`
          );
          return;
        }
      }
      onSaved();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.message || d.error || "Failed to save");
    }
  };

  // Wrong-deal protection (Deal Identity follow-up, Oct 24, 2026):
  // delete goes through ConfirmDealDialog, which names the deal and
  // its codename, instead of a bare window.confirm.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = async () => {
    if (!deal) return;
    setBusy(true);
    const res = await fetch(`/api/deals/${deal.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) onDeleted();
    else setError("Failed to delete");
  };

  // New investment form (Oct 24, 2026): create + edit render the
  // type-first DealForm (sections from bd.metric_definitions). The
  // read-only view below is unchanged; Cancel in the form returns
  // here for an existing deal.
  if (editing) {
    return (
      <DealForm
        deal={deal}
        executives={executives}
        allDeals={allDeals}
        initialType={initialType}
        onClose={isNew ? onClose : () => setEditing(false)}
        onSaved={onSaved}
      />
    );
  }

  return (
    <>
    <ModalShell title={isNew ? "New investment" : deal!.companyName} onClose={onClose}>
      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}
      {editing && <DupeWarning deal={deal} allDeals={allDeals} name={form.companyName} />}

      {!editing && deal ? (
        <div>
          {/* Record header band (Wave 3): graded sector strip above
              the detail rows — same band as the dossier page. */}
          <div className="mb-4">
            <DealRecordHeader deal={deal} multiples={multiples} rates={rates} />
          </div>
          <div className="flex flex-col divide-y divide-slate-100 dark:divide-white/10">
          <DetailRow
            label="Industry"
            value={
              deal.industry ? (
                <span className="inline-flex items-center gap-1.5">
                  <SectorChip sector={dealFocusSector(deal.industry) ?? deal.industry} />
                </span>
              ) : (
                ""
              )
            }
          />
          <DetailRow label="City" value={deal.city} />
          <DetailRow label="Stage" value={<StageChip stage={deal.stage} />} />
          <DetailRow
            label="Investment type"
            value={<TypeBadge type={deal.investmentType} />}
          />
          {deal.investmentType === "add_on" && (
            <DetailRow
              label="Parent platform"
              value={
                allDeals.find((x) => x.id === deal.parentDealId)
                  ?.companyName ?? "—"
              }
            />
          )}
          {deal.investmentType === "early_stage" && deal.sourcedFromId && (
            <DetailRow
              label="Sourced from"
              value={
                bd?.sourcedFromOptions.portfolioCompanies.find(
                  (o) => o.id === deal.sourcedFromId
                )?.label ??
                bd?.sourcedFromOptions.marketInsights.find(
                  (o) => o.id === deal.sourcedFromId
                )?.label ??
                "—"
              }
            />
          )}
          {bd &&
            (() => {
              const defs = applicableDefs(
                bd.config,
                deal.investmentType ?? "platform_lbo",
                deal.industry
              ).filter((d) => bd.metricsByDeal[deal.id]?.[d.key]);
              if (!defs.length) return null;
              return (
                <DetailRow
                  label="Type metrics"
                  value={
                    <span className="flex flex-col gap-0.5">
                      {defs.map((d) => (
                        <span key={d.key}>
                          {d.label}:{" "}
                          <span className="font-medium">
                            {fmtMetricValue(d, bd.metricsByDeal[deal.id][d.key])}
                          </span>
                        </span>
                      ))}
                    </span>
                  }
                />
              );
            })()}
          <DetailRow
            label="Deal value"
            value={(() => {
              const rv = resolveDealValue(deal, multiples, rates);
              return rv.value === null ? "—" : `${fmtMoney(rv.value)}${rv.estimated ? " est." : ""}`;
            })()}
          />
          <DetailRow
            label="Revenue"
            value={deal.revenue != null ? fmtMoney(deal.revenue) : "—"}
          />
          <DetailRow
            label="EBITDA"
            value={deal.ebitda != null ? fmtMoney(deal.ebitda) : "—"}
          />
          <DetailRow
            label="Asking price"
            value={deal.askingPrice != null ? fmtMoney(deal.askingPrice) : "—"}
          />
          <DetailRow label="Broker" value={deal.broker || "—"} />
          <DetailRow label="Source" value={deal.source ? dedupeSourceTokens(deal.source) : "—"} />
          <DetailRow label="Contact" value={deal.contactName} />
          <DetailRow label="Contact email" value={deal.contactEmail} />
          <DetailRow label="Owner" value={deal.owner} />
          <DetailRow
            label="Paired operators"
            value={
              deal.operatorIds && deal.operatorIds.length > 0 ? (
                <span className="flex flex-col gap-0.5">
                  {uniqueStrings(deal.operatorIds).map((id) => {
                    const op = executives.find((e) => e.id === id);
                    return (
                      <span key={id}>
                        {op ? op.name : "Unknown operator"}
                        {op && op.industries && op.industries.length > 0 && (
                          <span className="text-slate-400 dark:text-white/40">
                            {" "}
                            · {uniqueStrings(op.industries).join(", ")}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </span>
              ) : (
                "—"
              )
            }
          />
          <DetailRow
            label="Links"
            value={
              deal.links && deal.links.length > 0 ? (
                <span className="flex flex-col gap-1">
                  {deal.links.map((l, i) => (
                    <a
                      key={i}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
                    >
                      {l.label || l.url} ↗
                    </a>
                  ))}
                </span>
              ) : (
                "—"
              )
            }
          />
          <DetailRow label="Notes" value={<span className="whitespace-pre-wrap text-slate-800 dark:text-[#e8dfc8]">{deal.notes}</span>} />
          <DetailRow label="Created" value={fmtDate(deal.createdAt)} />
          <DetailRow label="Updated" value={fmtDate(deal.updatedAt)} />
          {viewEst && (
            <div className="py-3">
              <p className="mb-1 text-xs font-medium text-slate-600 dark:text-[#c8bfa8]">
                Estimated multiple (rough — sharpens as more is recorded)
              </p>
              <EstimateBody est={viewEst} />
            </div>
          )}
          {deal.synthesis && (
            <div className="mult-bubble mb-3 rounded-2xl border border-[#b8975a]/40 bg-[#b8975a]/5 px-4 py-3 dark:bg-[#b8975a]/10">
              <button
                onClick={() => setShowSynthesis((v) => !v)}
                className="flex w-full items-center justify-between gap-2 text-left"
                aria-expanded={showSynthesis}
              >
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8a6f3c] dark:text-[#d4b37a]">
                  Synthesis{deal.synthesis.author ? ` — ${deal.synthesis.author}` : ""} · {fmtDate(deal.synthesis.updatedAt)}
                </span>
                <span className="shrink-0 text-xs font-semibold text-[#8a6f3c] dark:text-[#d4b37a]">
                  {showSynthesis ? "Hide details ▴" : "Details ▾"}
                </span>
              </button>
              {showSynthesis && (
                <>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-[#e8dfc8]">{deal.synthesis.text}</p>
                  {viewEst && viewEst.sourcesUsed.length > 0 && (
                    <p className="mt-2 border-t border-[#b8975a]/25 pt-2 text-xs text-slate-500 dark:text-white/50">
                      Sources: {viewEst.sourcesUsed.join(" · ")}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {(deal.stage === "Passed" || deal.stage === "Closed Won") && (
            <div className="py-3">
              <CompLogSection deal={deal} onLogged={loadMultiples} />
            </div>
          )}
          <div className="flex gap-2 pt-4">
            <button
              onClick={() => setEditing(true)}
              className="btn btn-primary flex-1"
            >
              Edit
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="btn btn-danger"
            >
              Delete
            </button>
          </div>
          </div>
        </div>
      ) : null}
    </ModalShell>
    {deal && (
      <ConfirmDealDialog
        open={confirmDelete}
        actionLabel="Delete deal"
        companyName={deal.companyName}
        codename={deal.codename ?? ""}
        detail="This removes the deal record from the pipeline."
        danger
        busy={busy}
        confirmLabel="Delete deal"
        onConfirm={() => {
          setConfirmDelete(false);
          void remove();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    )}
    </>
  );
}

// ---------------- Executive modal ----------------

interface ExecutiveModalProps {
  exec: Executive | null; // null = create new
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export function ExecutiveModal({ exec, onClose, onSaved, onDeleted }: ExecutiveModalProps) {
  const isNew = !exec;
  const [editing, setEditing] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: exec?.name ?? "",
    currentTitle: exec?.currentTitle ?? "",
    targetRole: exec?.targetRole ?? "",
    stage: exec?.stage ?? ("Sourcing" as Executive["stage"]),
    background: exec?.background ?? "",
    notes: exec?.notes ?? "",
    owner: exec?.owner ?? "",
    industries: (exec?.industries ?? []).join(", "),
    photoUrl: exec?.photoUrl ?? "",
  });

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setBusy(true);
    setError("");
    const payload = { ...form, industries: form.industries };
    const res = await fetch(isNew ? "/api/executives" : `/api/executives/${exec!.id}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (res.ok) onSaved();
    else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to save");
    }
  };

  const remove = async () => {
    if (!exec || !window.confirm(`Delete "${exec.name}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/executives/${exec.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) onDeleted();
    else setError("Failed to delete");
  };

  return (
    <ModalShell title={isNew ? "New Executive Candidate" : exec!.name} onClose={onClose}>
      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}

      {!editing && exec ? (
        <div className="flex flex-col divide-y divide-slate-100 dark:divide-white/10">
          <DetailRow label="Current title" value={exec.currentTitle} />
          <DetailRow label="Target role" value={exec.targetRole} />
          <DetailRow label="Stage" value={<StageChip stage={exec.stage} />} />
          <DetailRow label="Owner" value={exec.owner} />
          <DetailRow
            label="Industries"
            value={
              exec.industries && exec.industries.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {uniqueStrings(exec.industries).map((ind) => (
                    <SectorChip key={ind} sector={dealFocusSector(ind) ?? ind} />
                  ))}
                </span>
              ) : (
                "—"
              )
            }
          />
          <DetailRow label="Background" value={<span className="whitespace-pre-wrap">{exec.background}</span>} />
          <DetailRow label="Notes" value={<span className="whitespace-pre-wrap">{exec.notes}</span>} />
          <DetailRow label="Created" value={fmtDate(exec.createdAt)} />
          <DetailRow label="Updated" value={fmtDate(exec.updatedAt)} />
          <div className="flex gap-2 pt-4">
            <button
              onClick={() => setEditing(true)}
              className="btn btn-primary flex-1"
            >
              Edit
            </button>
            <button
              onClick={remove}
              disabled={busy}
              className="btn btn-danger"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Name *">
            <input className={inputCls} value={form.name} onChange={set("name")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current title">
              <input className={inputCls} value={form.currentTitle} onChange={set("currentTitle")} />
            </Field>
            <Field label="Target role">
              <input className={inputCls} value={form.targetRole} onChange={set("targetRole")} />
            </Field>
          </div>
          <Field label="Stage">
            <select className={inputCls} value={form.stage} onChange={set("stage")}>
              {EXEC_STAGES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Claimed by">
            <select
              className={inputCls}
              value={form.owner}
              onChange={set("owner")}
            >
              <option value="">Unclaimed</option>
              {PARTNER_NAMES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Industries / sectors (comma-separated)">
            <input
              className={inputCls}
              value={form.industries}
              onChange={set("industries")}
              placeholder="e.g. Industrial Services, Healthcare"
            />
          </Field>
          <Field label="Photo URL (optional)">
            <input className={inputCls} value={form.photoUrl ?? ""} onChange={set("photoUrl")} placeholder="https://… (initials shown if blank)" />
          </Field>
          <Field label="Background">
            <textarea className={inputCls} rows={3} value={form.background} onChange={set("background")} />
          </Field>
          <Field label="Notes">
            <textarea className={inputCls} rows={3} value={form.notes} onChange={set("notes")} />
          </Field>
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={busy} data-loading={busy || undefined}
              className="btn btn-primary flex-1"
            >
              {busy ? "Saving…" : isNew ? "Add candidate" : "Save changes"}
            </button>
            {!isNew && (
              <button
                onClick={() => setEditing(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
