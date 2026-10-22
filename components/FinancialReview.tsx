"use client";

/**
 * FinancialReview (Phase 4, workstream D) — draft statement review.
 *
 * Fetches GET /api/platform/financials/sets/[setId] plus the source
 * document (detail + extracted text). Left pane previews the source:
 * PDF/image render from the Phase 3 file route; every format also
 * shows the extracted text with the selected line's snippet
 * highlighted (<mark>) — PDF coordinates are not available from the
 * current extractor, so the snippet highlight is the in-place
 * mechanism, while XLSX cell refs (Sheet!B14) are exact and shown as
 * a badge on the line. Right pane edits metadata + lines, shows the
 * server checks, and Saves (PATCH) / Posts (POST /post). Posting
 * with an unreconciled EBITDA requires the override note — the API's
 * ebitda_override_required error is surfaced and the note field is
 * focused. Posted sets render read-only with Restate + Create
 * adjusted draft actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import IntegrityPanel, {
  type IntegrityCheckResult,
} from "@/components/IntegrityPanel";
import { fmtDate, fmtMoney } from "@/lib/format";

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

interface EditableLine extends FinLine {
  valueText: string;
  removed?: boolean;
  isNew?: boolean;
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

interface DocInfo {
  id: string;
  name: string;
  mime: string;
  extractionStatus?: string;
}

interface DocText {
  status: string;
  text: string;
  extractor?: string;
  note?: string;
}

/* ---------------- Template line options (contract) ---------------- */

const TEMPLATE_OPTIONS: Record<string, { key: string; label: string }[]> = {
  is: [
    { key: "revenue", label: "Revenue" },
    { key: "cogs", label: "Cost of goods sold" },
    { key: "gross_profit", label: "Gross profit" },
    { key: "opex_detail", label: "Operating expense (detail)" },
    { key: "operating_expenses", label: "Operating expenses" },
    { key: "ebitda", label: "EBITDA" },
    { key: "depreciation_amortization", label: "Depreciation & amortization" },
    { key: "ebit", label: "EBIT" },
    { key: "interest_expense", label: "Interest expense" },
    { key: "other_income", label: "Other income" },
    { key: "pretax_income", label: "Pre-tax income" },
    { key: "income_taxes", label: "Income taxes" },
    { key: "net_income", label: "Net income" },
    { key: "unmapped", label: "Unmapped" },
  ],
  bs: [
    { key: "cash", label: "Cash" },
    { key: "accounts_receivable", label: "Accounts receivable" },
    { key: "inventory", label: "Inventory" },
    { key: "other_current_assets", label: "Other current assets" },
    { key: "total_current_assets", label: "Total current assets" },
    { key: "ppe_net", label: "PP&E (net)" },
    { key: "intangible_assets", label: "Intangible assets" },
    { key: "other_assets", label: "Other assets" },
    { key: "total_assets", label: "Total assets" },
    { key: "accounts_payable", label: "Accounts payable" },
    { key: "current_debt", label: "Current debt" },
    { key: "other_current_liabilities", label: "Other current liabilities" },
    { key: "total_current_liabilities", label: "Total current liabilities" },
    { key: "long_term_debt", label: "Long-term debt" },
    { key: "other_liabilities", label: "Other liabilities" },
    { key: "total_liabilities", label: "Total liabilities" },
    { key: "total_equity", label: "Total equity" },
    { key: "total_liab_equity", label: "Total liabilities & equity" },
    { key: "unmapped", label: "Unmapped" },
  ],
  cf: [
    { key: "cfo", label: "Cash flow from operations" },
    { key: "cfi", label: "Cash flow from investing" },
    { key: "cff", label: "Cash flow from financing" },
    { key: "net_change_cash", label: "Net change in cash" },
    { key: "cash_begin", label: "Cash — beginning" },
    { key: "cash_end", label: "Cash — ending" },
    { key: "unmapped", label: "Unmapped" },
  ],
};

const KIND_LABELS: Record<string, string> = {
  is: "Income statement",
  bs: "Balance sheet",
  cf: "Cash flow",
};
const KIND_ORDER = ["is", "bs", "cf"];
const BASIS_OPTIONS = ["AUDITED", "REVIEWED", "COMPILED", "COMPANY-PREPARED", "TAX-BASIS"];
const PERIOD_TYPE_OPTIONS = ["annual", "quarterly", "monthly", "ytd", "ttm"];

const FLAG_LABELS: Record<string, string> = {
  does_not_balance: "Does not balance",
  ebitda_variance: "EBITDA variance",
  incomplete_period: "Incomplete period",
  missing_balance_sheet: "Missing balance sheet",
  missing_income_statement: "Missing income statement",
};

/* ---------------- Helpers ---------------- */

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] disabled:opacity-60 dark:border-white/10 dark:bg-[#132847]/60 dark:text-white";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

function toDateInput(v: string | null | undefined): string {
  if (!v) return "";
  return v.slice(0, 10);
}

function toEditable(line: FinLine): EditableLine {
  return {
    ...line,
    source: line.source ?? {},
    valueText: line.value === null || line.value === undefined ? "" : String(line.value),
  };
}

function parseValueText(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function provenanceText(line: FinLine): string {
  const src = line.source ?? {};
  const parts: string[] = [];
  if (typeof src.page === "number") parts.push(`p. ${src.page}`);
  if (typeof src.line === "number") parts.push(`line ${src.line}`);
  if (src.snippet) {
    const snip = src.snippet.length > 64 ? `${src.snippet.slice(0, 64)}…` : src.snippet;
    parts.push(`“${snip}”`);
  }
  return parts.join(" · ");
}

function cellBadge(line: FinLine): string | null {
  const src = line.source ?? {};
  if (!src.cell) return null;
  return src.sheet ? `${src.sheet} · ${src.cell}` : src.cell;
}

function confidenceChip(c: number | null | undefined): { label: string; cls: string } {
  if (c === null || c === undefined || !Number.isFinite(c)) {
    return { label: "no score", cls: "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/60" };
  }
  const pct = `${Math.round(c * 100)}%`;
  if (c >= 0.85) return { label: pct, cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" };
  if (c >= 0.6) return { label: pct, cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" };
  return { label: pct, cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" };
}

let newSeq = 0;
function nextNewId(): string {
  newSeq += 1;
  return `new-${Date.now()}-${newSeq}`;
}

/* ---------------- Component ---------------- */

export default function FinancialReview({ setId }: { setId: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [finSet, setFinSet] = useState<FinSet | null>(null);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [doc, setDoc] = useState<DocInfo | null>(null);
  const [docText, setDocText] = useState<DocText | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  // Metadata draft
  const [periodType, setPeriodType] = useState("annual");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [basis, setBasis] = useState("COMPANY-PREPARED");
  const [unitMultiplier, setUnitMultiplier] = useState("1");
  const [unitsLabel, setUnitsLabel] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [ebitdaOverrideNote, setEbitdaOverrideNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  // Action state
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ebitdaError, setEbitdaError] = useState<{
    ebitdaStated: number | null;
    ebitdaComputed: number | null;
    ebitdaVariance: number | null;
  } | null>(null);
  const [justPosted, setJustPosted] = useState(false);

  // Part 4B integrity suite (live, includes this draft set) — fetched
  // once the set loads; rendered under the checks panel.
  const [integrityResults, setIntegrityResults] = useState<IntegrityCheckResult[] | null>(null);

  const [showRestate, setShowRestate] = useState(false);
  const [restateReason, setRestateReason] = useState("");
  const [restateBusy, setRestateBusy] = useState(false);
  const [restateResultId, setRestateResultId] = useState<string | null>(null);
  const [adjustedBusy, setAdjustedBusy] = useState(false);
  const [adjustedResultId, setAdjustedResultId] = useState<string | null>(null);

  const isPosted = finSet?.status === "posted";
  const readOnly = Boolean(isPosted);

  const loadSet = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setNotFound(false);
    try {
      const res = await fetch(`/api/platform/financials/sets/${encodeURIComponent(setId)}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { set: FinSet; lines: FinLine[] };
      const s = data.set;
      setFinSet(s);
      setLines((Array.isArray(data.lines) ? data.lines : []).map(toEditable));
      setPeriodType(s.periodType || "annual");
      setPeriodStart(toDateInput(s.periodStart));
      setPeriodEnd(toDateInput(s.periodEnd));
      setBasis(s.basis || "COMPANY-PREPARED");
      setUnitMultiplier(String(s.unitMultiplier || 1));
      setUnitsLabel(s.unitsLabel || "");
      setCurrency(s.currency || "USD");
      setEbitdaOverrideNote(s.ebitdaOverrideNote || "");
      // Source document detail + extracted text (snippet context).
      if (s.documentId) {
        try {
          const dres = await fetch(
            `/api/platform/documents/${encodeURIComponent(s.documentId)}`
          );
          if (dres.ok) {
            const dj = (await dres.json()) as { document?: DocInfo };
            if (dj.document) setDoc(dj.document);
          }
        } catch {
          /* preview is best-effort */
        }
        try {
          const tres = await fetch(
            `/api/platform/documents/${encodeURIComponent(s.documentId)}/text`
          );
          if (tres.ok) setDocText((await tres.json()) as DocText);
        } catch {
          /* text context is best-effort */
        }
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [setId]);

  useEffect(() => {
    void loadSet();
  }, [loadSet]);

  // Fetch the Part 4B integrity suite for this set once it has loaded
  // (posted company sets + this draft via setId). Best-effort: a failed
  // fetch leaves the panel hidden rather than blocking review.
  useEffect(() => {
    if (!finSet) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/platform/financials/analysis/integrity?companyId=${encodeURIComponent(finSet.companyId)}&setId=${encodeURIComponent(finSet.id)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as { results?: IntegrityCheckResult[] };
        if (!cancelled) {
          setIntegrityResults(Array.isArray(data.results) ? data.results : []);
        }
      } catch {
        /* integrity panel is auxiliary */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [finSet]);

  const selectedLine = useMemo(
    () => lines.find((l) => l.id === selectedLineId) ?? null,
    [lines, selectedLineId]
  );

  const ocrGap =
    doc?.extractionStatus === "unsupported" ||
    finSet?.extractionStatus === "unsupported" ||
    docText?.status === "unsupported";
  const ocrNote =
    docText?.note ??
    "Image OCR is not configured: no OCR provider (e.g. Azure AI Document Intelligence) is connected. Lines for this document must be entered manually.";

  const patchLine = useCallback((id: string, patch: Partial<EditableLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const addLine = useCallback((kind: string) => {
    const nl: EditableLine = {
      id: nextNewId(),
      setId,
      statementKind: kind,
      lineKey: "unmapped",
      label: "",
      value: null,
      valueText: "",
      rawValue: null,
      isDerived: false,
      isSubtotal: false,
      confidence: null,
      source: {},
      sort: 9999,
      isNew: true,
    };
    setLines((prev) => [...prev, nl]);
    setSelectedLineId(nl.id);
  }, [setId]);

  const buildPatchBody = useCallback(() => {
    const payloadLines: Record<string, unknown>[] = [];
    for (const l of lines) {
      if (l.removed) {
        if (!l.isNew) payloadLines.push({ id: l.id, deleted: true });
        continue;
      }
      const base: Record<string, unknown> = {
        statementKind: l.statementKind,
        lineKey: l.lineKey,
        label: l.label,
        value: parseValueText(l.valueText),
      };
      if (!l.isNew) base.id = l.id;
      payloadLines.push(base);
    }
    return {
      metadata: {
        periodType,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        basis,
        unitMultiplier: Number(unitMultiplier) || 1,
        unitsLabel,
        currency: currency.trim() || "USD",
      },
      lines: payloadLines,
      ebitdaOverrideNote,
    };
  }, [lines, periodType, periodStart, periodEnd, basis, unitMultiplier, unitsLabel, currency, ebitdaOverrideNote]);

  const saveDraft = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    setActionError(null);
    try {
      const res = await fetch(`/api/platform/financials/sets/${encodeURIComponent(setId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPatchBody()),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSaveMsg("Draft saved — checks refreshed.");
      await loadSet();
    } catch (err) {
      setActionError(
        err instanceof Error && err.message !== `HTTP 500`
          ? `Could not save: ${err.message}`
          : "Could not save the draft — try again."
      );
    } finally {
      setSaving(false);
    }
  }, [setId, buildPatchBody, loadSet]);

  const postSet = useCallback(async () => {
    setPosting(true);
    setSaveMsg(null);
    setActionError(null);
    setEbitdaError(null);
    try {
      const res = await fetch(`/api/platform/financials/sets/${encodeURIComponent(setId)}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ebitdaOverrideNote }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ebitdaStated?: number | null;
        ebitdaComputed?: number | null;
        ebitdaVariance?: number | null;
      };
      if (res.status === 400 && data.error === "ebitda_override_required") {
        setEbitdaError({
          ebitdaStated: data.ebitdaStated ?? null,
          ebitdaComputed: data.ebitdaComputed ?? null,
          ebitdaVariance: data.ebitdaVariance ?? null,
        });
        // Focus the override note field so the fix is one step away.
        window.setTimeout(() => {
          noteRef.current?.focus();
          noteRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 50);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setJustPosted(true);
      await loadSet();
    } catch (err) {
      setActionError(
        err instanceof Error ? `Could not post: ${err.message}` : "Could not post — try again."
      );
    } finally {
      setPosting(false);
    }
  }, [setId, ebitdaOverrideNote, loadSet]);

  const restate = useCallback(async () => {
    if (!restateReason.trim()) return;
    setRestateBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/platform/financials/sets/${encodeURIComponent(setId)}/restate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: restateReason.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
        set?: { id: string };
        draft?: { id: string };
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const newId = data.set?.id ?? data.draft?.id ?? data.id ?? null;
      setRestateResultId(newId ?? "");
    } catch (err) {
      setActionError(err instanceof Error ? `Could not restate: ${err.message}` : "Could not restate — try again.");
    } finally {
      setRestateBusy(false);
    }
  }, [setId, restateReason]);

  const createAdjusted = useCallback(async () => {
    setAdjustedBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/platform/financials/sets/${encodeURIComponent(setId)}/adjusted`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
        set?: { id: string };
        draft?: { id: string };
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const newId = data.set?.id ?? data.draft?.id ?? data.id ?? null;
      setAdjustedResultId(newId ?? "");
    } catch (err) {
      setActionError(err instanceof Error ? `Could not create adjusted draft: ${err.message}` : "Could not create adjusted draft — try again.");
    } finally {
      setAdjustedBusy(false);
    }
  }, [setId]);

  /* ----- render states ----- */

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonRows rows={6} />
      </div>
    );
  }
  if (notFound) {
    return (
      <EmptyState
        title="Statement set not found"
        message="This financial statement set doesn't exist, or the link is out of date."
        actionLabel="Back to Overview"
        href="/overview"
      />
    );
  }
  if (loadError || !finSet) {
    return (
      <ErrorState
        title="Could not load this statement set"
        message="The review screen could not be loaded — the database may be unavailable. Try again in a moment."
        onRetry={() => void loadSet()}
      />
    );
  }

  const s = finSet;
  const checks = s.checks ?? {};
  const docMime = doc?.mime ?? "";
  const isPdf = docMime === "application/pdf";
  const isImage = docMime.startsWith("image/");
  const fileUrl = s.documentId
    ? `/api/platform/documents/${encodeURIComponent(s.documentId)}/file`
    : null;
  const snippet = selectedLine?.source?.snippet ?? "";
  const textBody = docText?.text ?? "";
  const snippetFound = Boolean(snippet && textBody.includes(snippet));
  const snippetIdx = snippetFound ? textBody.indexOf(snippet) : -1;

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/companies/${encodeURIComponent(s.companyId)}`}
          className="text-sm font-semibold text-gold-700 hover:underline dark:text-gold-400"
        >
          ← Company profile
        </Link>
        <span className={`badge ${isPosted ? "badge-fit" : "badge-warn"}`}>{s.status}</span>
        <span className="badge badge-neutral">{s.layer}</span>
        <span className="badge badge-neutral">v{s.version}</span>
        <span className="text-sm text-caption">
          {s.periodType}
          {s.periodEnd ? ` · ends ${fmtDate(s.periodEnd)}` : ""} · {s.basis}
        </span>
        {s.restateReason && (
          <span className="text-xs text-caption">Restatement: {s.restateReason}</span>
        )}
        {isPosted && s.postedAt && (
          <span className="text-xs text-caption">
            Posted {fmtDate(s.postedAt)}
            {s.postedBy ? ` by ${s.postedBy}` : ""}
          </span>
        )}
      </div>

      {justPosted && (
        <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          Posted. This set is now the current {s.layer} version for its period.{" "}
          <Link
            href={`/companies/${encodeURIComponent(s.companyId)}`}
            className="font-semibold underline"
          >
            Back to the company profile
          </Link>
        </div>
      )}
      {actionError && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {actionError}
        </p>
      )}
      {saveMsg && !justPosted && (
        <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
          {saveMsg}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* -------- Left pane: source document -------- */}
        <section className="card-surface min-w-0 p-5" aria-label="Source document">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
            Source document
          </h2>
          {doc ? (
            <p className="mb-3 truncate text-sm text-slate-700 dark:text-white/80">
              {doc.name} <span className="text-caption">· {doc.mime || "—"}</span>
            </p>
          ) : (
            <p className="mb-3 text-sm text-caption">
              {s.documentId ? "Loading document…" : "No source document linked to this set."}
            </p>
          )}

          {ocrGap && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
            >
              <span className="font-semibold">OCR gap: </span>
              {ocrNote}
            </div>
          )}

          {fileUrl && isPdf && (
            <iframe
              title={doc?.name ?? "Source document"}
              src={fileUrl}
              className="h-[480px] w-full rounded-xl border border-slate-200 dark:border-white/10"
            />
          )}
          {fileUrl && isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fileUrl}
              alt={doc?.name ?? "Source document"}
              className="max-h-[480px] w-full rounded-xl border border-slate-200 object-contain dark:border-white/10"
            />
          )}

          {selectedLine && (
            <div className="mt-4 rounded-xl bg-slate-50 px-3.5 py-3 dark:bg-white/5">
              <p className="micro-label mb-1">Selected line</p>
              <p className="text-sm font-medium text-[#0d1f3c] dark:text-white">
                {selectedLine.label || selectedLine.lineKey}
                {cellBadge(selectedLine) && (
                  <span className="badge badge-neutral ml-2">{cellBadge(selectedLine)}</span>
                )}
              </p>
              {provenanceText(selectedLine) && (
                <p className="mt-0.5 text-xs text-caption">{provenanceText(selectedLine)}</p>
              )}
              {snippet && !snippetFound && textBody && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  The saved snippet was not found verbatim in the extracted text.
                </p>
              )}
            </div>
          )}

          <div className="mt-4">
            <p className="micro-label mb-1.5">
              Extracted text{docText?.extractor ? ` · ${docText.extractor}` : ""}
            </p>
            {!docText ? (
              <p className="text-sm text-caption">No extracted text available for this document.</p>
            ) : textBody ? (
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-[#0d1f3c] dark:border-white/10 dark:bg-white/5 dark:text-white/85">
                {snippetFound ? (
                  <>
                    {textBody.slice(0, snippetIdx)}
                    <mark className="bg-[#b8975a]/40 text-inherit">{snippet}</mark>
                    {textBody.slice(snippetIdx + snippet.length)}
                  </>
                ) : (
                  textBody
                )}
              </pre>
            ) : (
              <p className="text-sm text-caption">
                {docText.note ?? `No text extracted (status: ${docText.status}).`}
              </p>
            )}
            {snippet && (
              <p className="mt-1.5 text-xs text-caption">
                Select a line on the right to highlight its source snippet here. XLSX cell
                references on each line are exact; PDF positions are shown by snippet, not
                coordinates.
              </p>
            )}
          </div>
        </section>

        {/* -------- Right pane: metadata, lines, checks, actions -------- */}
        <div className="min-w-0 space-y-4">
          <section className="card-surface p-5" aria-label="Period metadata">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Period &amp; basis
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="rv-period-type">Period type</label>
                <select
                  id="rv-period-type"
                  value={periodType}
                  disabled={readOnly}
                  onChange={(e) => setPeriodType(e.target.value)}
                  className={`${inputCls} min-h-[44px]`}
                >
                  {PERIOD_TYPE_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="rv-basis">Basis</label>
                <select
                  id="rv-basis"
                  value={basis}
                  disabled={readOnly}
                  onChange={(e) => setBasis(e.target.value)}
                  className={`${inputCls} min-h-[44px]`}
                >
                  {BASIS_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="rv-start">Period start</label>
                <input
                  id="rv-start"
                  type="date"
                  value={periodStart}
                  disabled={readOnly}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className={`${inputCls} min-h-[44px]`}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="rv-end">Period end</label>
                <input
                  id="rv-end"
                  type="date"
                  value={periodEnd}
                  disabled={readOnly}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className={`${inputCls} min-h-[44px]`}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="rv-units">Units</label>
                <select
                  id="rv-units"
                  value={unitMultiplier}
                  disabled={readOnly}
                  onChange={(e) => setUnitMultiplier(e.target.value)}
                  className={`${inputCls} min-h-[44px]`}
                >
                  <option value="1">Dollars (×1)</option>
                  <option value="1000">In thousands (×1,000)</option>
                  <option value="1000000">In millions (×1,000,000)</option>
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="rv-units-label">Units label</label>
                <input
                  id="rv-units-label"
                  value={unitsLabel}
                  disabled={readOnly}
                  onChange={(e) => setUnitsLabel(e.target.value)}
                  placeholder="e.g. in thousands"
                  className={`${inputCls} min-h-[44px]`}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="rv-currency">Currency</label>
                <input
                  id="rv-currency"
                  value={currency}
                  disabled={readOnly}
                  onChange={(e) => setCurrency(e.target.value)}
                  className={`${inputCls} min-h-[44px]`}
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-caption">
              Line values below are normalized dollars (units already applied).
            </p>
          </section>

          {/* Lines by kind */}
          {KIND_ORDER.map((kind) => {
            const kindLines = lines.filter((l) => l.statementKind === kind);
            return (
              <section key={kind} className="card-surface p-5" aria-label={KIND_LABELS[kind]}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
                    {KIND_LABELS[kind]}
                  </h2>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => addLine(kind)}
                      className="btn btn-secondary btn-sm min-h-[44px]"
                    >
                      Add line
                    </button>
                  )}
                </div>
                {kindLines.length === 0 ? (
                  <p className="text-sm text-caption">No {KIND_LABELS[kind].toLowerCase()} lines.</p>
                ) : (
                  <ul className="space-y-3">
                    {kindLines.map((line) => {
                      const chip = confidenceChip(line.confidence);
                      const cell = cellBadge(line);
                      const prov = provenanceText(line);
                      const isSelected = selectedLineId === line.id;
                      return (
                        <li
                          key={line.id}
                          onClick={() => setSelectedLineId(line.id)}
                          className={`rounded-xl border px-3 py-3 transition ${
                            line.removed
                              ? "border-red-200 bg-red-50/60 opacity-70 dark:border-red-500/20 dark:bg-red-500/5"
                              : isSelected
                                ? "border-[#b8975a] bg-[#b8975a]/10"
                                : "border-slate-200 dark:border-white/10"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}
                              title="Extraction confidence"
                            >
                              {chip.label}
                            </span>
                            {line.isDerived && <span className="badge badge-neutral">derived</span>}
                            {line.isSubtotal && <span className="badge badge-neutral">subtotal</span>}
                            {cell && <span className="badge badge-fit">{cell}</span>}
                            {line.removed && <span className="badge badge-danger">removed</span>}
                            {!readOnly && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  patchLine(line.id, { removed: !line.removed });
                                }}
                                className="btn btn-ghost btn-sm ml-auto min-h-[44px]"
                              >
                                {line.removed ? "Undo remove" : "Remove"}
                              </button>
                            )}
                          </div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_150px]">
                            <input
                              aria-label="Line label"
                              value={line.label}
                              disabled={readOnly || line.removed}
                              onChange={(e) => patchLine(line.id, { label: e.target.value })}
                              placeholder="Label"
                              className={`${inputCls} min-h-[44px]`}
                            />
                            <input
                              aria-label="Line value (normalized dollars)"
                              inputMode="decimal"
                              value={line.valueText}
                              disabled={readOnly || line.removed}
                              onChange={(e) => patchLine(line.id, { valueText: e.target.value })}
                              placeholder="Value"
                              className={`${inputCls} tnum min-h-[44px] text-right`}
                            />
                          </div>
                          <div className="mt-2">
                            <label className="sr-only" htmlFor={`lk-${line.id}`}>Template line</label>
                            <select
                              id={`lk-${line.id}`}
                              value={line.lineKey}
                              disabled={readOnly || line.removed}
                              onChange={(e) => patchLine(line.id, { lineKey: e.target.value })}
                              className={`${inputCls} min-h-[44px]`}
                            >
                              {(TEMPLATE_OPTIONS[kind] ?? []).map((o) => (
                                <option key={o.key} value={o.key}>
                                  {o.label} ({o.key})
                                </option>
                              ))}
                              {!(TEMPLATE_OPTIONS[kind] ?? []).some((o) => o.key === line.lineKey) && (
                                <option value={line.lineKey}>{line.lineKey}</option>
                              )}
                            </select>
                          </div>
                          {(prov || line.isNew) && (
                            <p className="mt-1.5 text-xs text-caption">
                              {line.isNew ? "New line — added in review." : prov}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}

          {/* Checks */}
          <section className="card-surface p-5" aria-label="Checks">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
              Checks
            </h2>
            <ul className="space-y-2 text-sm">
              <li className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[#0d1f3c] dark:text-white">Balance sheet</span>
                {checks.bsBalanced === true && (
                  <span className="text-emerald-700 dark:text-emerald-300">✓ Balances</span>
                )}
                {checks.bsBalanced === false && (
                  <span className="text-red-700 dark:text-red-300">
                    ⚠ Does not balance
                    {checks.bsVariance !== null && checks.bsVariance !== undefined
                      ? ` · variance ${fmtMoney(checks.bsVariance)}`
                      : ""}
                  </span>
                )}
                {(checks.bsBalanced === null || checks.bsBalanced === undefined) && (
                  <span className="text-caption">— not checked (no balance sheet)</span>
                )}
              </li>
              <li className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[#0d1f3c] dark:text-white">EBITDA</span>
                <span className="text-caption">
                  stated {checks.ebitdaStated !== null && checks.ebitdaStated !== undefined ? fmtMoney(checks.ebitdaStated) : "—"}
                  {" · "}computed{" "}
                  {checks.ebitdaComputed !== null && checks.ebitdaComputed !== undefined ? fmtMoney(checks.ebitdaComputed) : "—"}
                </span>
                {checks.ebitdaReconciles === true && (
                  <span className="text-emerald-700 dark:text-emerald-300">✓ Reconciles</span>
                )}
                {checks.ebitdaReconciles === false && (
                  <span className="text-red-700 dark:text-red-300">
                    ⚠ Variance
                    {checks.ebitdaVariance !== null && checks.ebitdaVariance !== undefined
                      ? ` ${fmtMoney(checks.ebitdaVariance)}`
                      : ""}
                  </span>
                )}
              </li>
              <li className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[#0d1f3c] dark:text-white">Cash flow tie</span>
                {checks.cfTies === true && (
                  <span className="text-emerald-700 dark:text-emerald-300">✓ Ties to cash</span>
                )}
                {checks.cfTies === false && (
                  <span className="text-red-700 dark:text-red-300">
                    ⚠ Does not tie
                    {checks.cfVariance !== null && checks.cfVariance !== undefined
                      ? ` · variance ${fmtMoney(checks.cfVariance)}`
                      : ""}
                  </span>
                )}
                {(checks.cfTies === null || checks.cfTies === undefined) && (
                  <span className="text-caption">— not checked</span>
                )}
              </li>
            </ul>
            {(checks.flags ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(checks.flags ?? []).map((f) => (
                  <span key={f} className={`badge ${f === "does_not_balance" ? "badge-danger" : "badge-warn"}`}>
                    {FLAG_LABELS[f] ?? f.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-4">
              <label className={labelCls} htmlFor="rv-ebitda-note">
                EBITDA override note (required to post when stated ≠ computed)
              </label>
              <textarea
                id="rv-ebitda-note"
                ref={noteRef}
                value={ebitdaOverrideNote}
                disabled={readOnly}
                onChange={(e) => setEbitdaOverrideNote(e.target.value)}
                rows={3}
                placeholder="Explain the EBITDA variance, e.g. owner add-backs per CIM p.12…"
                className={inputCls}
              />
              {ebitdaError && (
                <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
                  Posting blocked: stated EBITDA{" "}
                  {ebitdaError.ebitdaStated !== null ? fmtMoney(ebitdaError.ebitdaStated) : "—"}{" "}
                  differs from computed{" "}
                  {ebitdaError.ebitdaComputed !== null ? fmtMoney(ebitdaError.ebitdaComputed) : "—"}
                  {ebitdaError.ebitdaVariance !== null
                    ? ` (variance ${fmtMoney(ebitdaError.ebitdaVariance)})`
                    : ""}
                  . Add an override note above, then post again.
                </p>
              )}
            </div>
            {!readOnly && (
              <p className="mt-2 text-xs text-caption">Checks refresh when you save the draft.</p>
            )}
          </section>

          {/* Integrity suite (Part 4B) — live checks incl. this draft set */}
          {integrityResults !== null && (
            <section className="card-surface p-5" aria-label="Integrity checks">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
                Integrity checks
              </h2>
              <IntegrityPanel results={integrityResults} />
            </section>
          )}

          {/* Actions */}
          <section className="card-surface p-5" aria-label="Actions">
            {!readOnly ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving || posting}
                  onClick={() => void saveDraft()}
                  className="btn btn-secondary min-h-[44px]"
                >
                  {saving ? "Saving…" : "Save draft"}
                </button>
                <button
                  type="button"
                  disabled={saving || posting}
                  onClick={() => void postSet()}
                  className="btn btn-primary min-h-[44px]"
                >
                  {posting ? "Posting…" : "Post financials"}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-caption">
                  Posted sets are immutable. Restate to correct them, or create an adjusted draft
                  for normalization add-backs.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRestate((v) => !v)}
                    className="btn btn-secondary min-h-[44px]"
                  >
                    Restate
                  </button>
                  <button
                    type="button"
                    disabled={adjustedBusy}
                    onClick={() => void createAdjusted()}
                    className="btn btn-primary min-h-[44px]"
                  >
                    {adjustedBusy ? "Creating…" : "Create adjusted draft"}
                  </button>
                </div>
                {showRestate && (
                  <div className="rounded-xl border border-slate-200 p-3.5 dark:border-white/10">
                    <label className={labelCls} htmlFor="rv-restate-reason">Restatement reason</label>
                    <input
                      id="rv-restate-reason"
                      value={restateReason}
                      onChange={(e) => setRestateReason(e.target.value)}
                      placeholder="e.g. Corrected revenue recognition per CPA"
                      className={`${inputCls} min-h-[44px]`}
                    />
                    <button
                      type="button"
                      disabled={restateBusy || !restateReason.trim()}
                      onClick={() => void restate()}
                      className="btn btn-primary mt-2 min-h-[44px]"
                    >
                      {restateBusy ? "Creating draft…" : "Create restated draft"}
                    </button>
                  </div>
                )}
                {restateResultId !== null && (
                  <p className="text-sm text-emerald-700 dark:text-emerald-300">
                    Restated draft created.{" "}
                    {restateResultId ? (
                      <Link
                        href={`/financials/review/${encodeURIComponent(restateResultId)}`}
                        className="font-semibold underline"
                      >
                        Open the restated draft
                      </Link>
                    ) : (
                      "Find it in the company profile drafts list."
                    )}
                  </p>
                )}
                {adjustedResultId !== null && (
                  <p className="text-sm text-emerald-700 dark:text-emerald-300">
                    Adjusted draft created.{" "}
                    {adjustedResultId ? (
                      <Link
                        href={`/financials/review/${encodeURIComponent(adjustedResultId)}`}
                        className="font-semibold underline"
                      >
                        Open the adjusted draft
                      </Link>
                    ) : (
                      "Find it in the company profile drafts list."
                    )}
                  </p>
                )}
                <p>
                  <Link
                    href={`/companies/${encodeURIComponent(s.companyId)}`}
                    className="text-sm font-semibold text-gold-700 hover:underline dark:text-gold-400"
                  >
                    Back to the company profile
                  </Link>
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
