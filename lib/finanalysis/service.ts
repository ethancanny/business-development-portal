import { createHash } from "node:crypto";
import { sql, newId, str, num, numOrNull, isoOrNull } from "../platform/db";
import { onEvent } from "../platform/events";
import { enqueueJob } from "../platform/jobs";
import {
  listSets,
  getSet,
  createAdjustedDraft,
  updateSet,
  type LinePatch,
  type StatementSet,
  type StatementLine,
} from "../financials/service";
import { ensureFinanalysis } from "./schema";
import { buildAnalysisPayload } from "./engine";
import { runIntegritySuite } from "./integrity";
import {
  computeDealScreen,
  DEFAULT_DEAL_SCREEN_ASSUMPTIONS,
} from "./dealscreen";
import type {
  AcceptedAdjustmentInput,
  AnalysisPayload,
  AnalysisPeriodInput,
  IntegrityCheckResult,
  SuggestionSeed,
  WorkingCapitalData,
} from "./types";

export { ensureFinanalysis };

/**
 * Finanalysis service (Part 4B, workstream B) — automated financial
 * analysis over Phase 4 statement sets.
 *
 * Binding spec: ~/workspace/.p4bpush/CONTRACT.md ("Service" section).
 *
 * Module boundaries: Phase 4 financials data is read/written ONLY via
 * lib/financials/service.ts functions (listSets / getSet /
 * createAdjustedDraft / updateSet). SQL in this file touches only the
 * `finanalysis` schema plus `core.jobs` (platform job infra, allowed).
 * As-reported data is NEVER modified here — accepted suggestions write
 * only into the adjusted (QoE) layer via the Phase 4 service.
 *
 * Analyses run as a BACKGROUND JOB (kind 'analyze_financials') on
 * financials_posted — never synchronously in a post request. Pages read
 * the pre-aggregated payload stored in finanalysis.analyses.data.
 * Analyses are drafts until approved; published reads
 * (getPublishedAnalysis / getWorkingCapital) return data ONLY for
 * approved analyses.
 *
 * Error convention mirrors financials: throw Error whose message is the
 * contract error code ('amount_required', 'analysis_not_found', …).
 * Financial figures NEVER appear in logs — ids/statuses only.
 */

/* ------------------------------- types ------------------------------ */

export interface AnalysisRecord {
  id: string;
  companyId: string;
  dealId: string | null;
  status: string;
  isCurrent: boolean;
  inputFingerprint: string;
  inputs: Record<string, unknown>;
  reviewedBy: string | null;
  reviewedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdjustmentRecord {
  id: string;
  analysisId: string;
  companyId: string;
  reportedSetId: string;
  kind: string;
  label: string;
  amount: number | null;
  direction: string;
  rationale: string;
  source: Record<string, unknown>;
  requiresInput: string | null;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decidedAmount: number | null;
  adjustedSetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BenchmarkRecord {
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

export interface BenchmarkInput {
  id?: string;
  industry?: string;
  metricKey: string;
  median?: number | null;
  p25?: number | null;
  p75?: number | null;
  sampleSize?: number | null;
  source?: string;
  note?: string;
}

/* ------------------------------ helpers ----------------------------- */

function jsonObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  if (typeof v === "string" && v) {
    try {
      const parsed: unknown = JSON.parse(v);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through to empty object */
    }
  }
  return {};
}

function jsonPayload(v: unknown): AnalysisPayload {
  const obj = jsonObj(v);
  return obj as unknown as AnalysisPayload;
}

/** First non-null value for a template line key (mirrors Phase 4 lineVal). */
function lineVal(lines: StatementLine[], lineKey: string): number | null {
  const hit = lines.find((l) => l.lineKey === lineKey);
  return hit ? hit.value : null;
}

/** Period ordering: periodEnd ascending, nulls last, then periodStart. */
function byPeriodAsc(
  a: AnalysisPeriodInput,
  b: AnalysisPeriodInput
): number {
  const ae = a.set.periodEnd ?? "";
  const be = b.set.periodEnd ?? "";
  if (ae && be && ae !== be) return ae < be ? -1 : 1;
  if (ae && !be) return -1;
  if (!ae && be) return 1;
  const as = a.set.periodStart ?? "";
  const bs = b.set.periodStart ?? "";
  if (as === bs) return 0;
  return as < bs ? -1 : 1;
}

function latestPeriod(
  periods: AnalysisPeriodInput[]
): AnalysisPeriodInput | null {
  if (!periods.length) return null;
  return [...periods].sort(byPeriodAsc)[periods.length - 1] ?? null;
}

/**
 * Input fingerprint: sha256 of the JSON of the sorted
 * [{id, version, updatedAt}] of the input statement sets.
 */
function fingerprintOf(sets: StatementSet[]): string {
  const rows = sets
    .map((s) => ({ id: s.id, version: s.version, updatedAt: s.updatedAt }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function rowToAnalysis(r: Record<string, unknown>): AnalysisRecord {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    dealId: r.deal_id ? str(r.deal_id) : null,
    status: str(r.status) || "draft",
    isCurrent: r.is_current === true,
    inputFingerprint: str(r.input_fingerprint),
    inputs: jsonObj(r.inputs),
    reviewedBy: r.reviewed_by ? str(r.reviewed_by) : null,
    reviewedAt: isoOrNull(r.reviewed_at),
    approvedBy: r.approved_by ? str(r.approved_by) : null,
    approvedAt: isoOrNull(r.approved_at),
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToAdjustment(r: Record<string, unknown>): AdjustmentRecord {
  return {
    id: str(r.id),
    analysisId: str(r.analysis_id),
    companyId: str(r.company_id),
    reportedSetId: str(r.reported_set_id),
    kind: str(r.kind),
    label: str(r.label),
    amount: numOrNull(r.amount),
    direction: str(r.direction) || "add",
    rationale: str(r.rationale),
    source: jsonObj(r.source),
    requiresInput: r.requires_input ? str(r.requires_input) : null,
    status: str(r.status) || "proposed",
    decidedBy: r.decided_by ? str(r.decided_by) : null,
    decidedAt: isoOrNull(r.decided_at),
    decidedAmount: numOrNull(r.decided_amount),
    adjustedSetId: r.adjusted_set_id ? str(r.adjusted_set_id) : null,
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToBenchmark(r: Record<string, unknown>): BenchmarkRecord {
  return {
    id: str(r.id),
    industry: str(r.industry) || "general",
    metricKey: str(r.metric_key),
    median: numOrNull(r.median),
    p25: numOrNull(r.p25),
    p75: numOrNull(r.p75),
    sampleSize:
      r.sample_size === null || r.sample_size === undefined
        ? null
        : num(r.sample_size),
    source: str(r.source) || "manual",
    note: str(r.note),
    updatedBy: str(r.updated_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

const ANALYSIS_COLS =
  "id, company_id, deal_id, status, is_current, input_fingerprint, inputs, reviewed_by, reviewed_at, approved_by, approved_at, created_by, created_at, updated_at";
const ADJUSTMENT_COLS =
  "id, analysis_id, company_id, reported_set_id, kind, label, amount, direction, rationale, source, requires_input, status, decided_by, decided_at, decided_amount, adjusted_set_id, created_at, updated_at";
const BENCHMARK_COLS =
  "id, industry, metric_key, median, p25, p75, sample_size, source, note, updated_by, created_at, updated_at";

async function fetchAnalysisRow(
  id: string
): Promise<Record<string, unknown> | null> {
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(ANALYSIS_COLS)}, data FROM finanalysis.analyses
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  return rows.length ? (rows[0] as Record<string, unknown>) : null;
}

async function fetchAdjustmentRow(
  id: string
): Promise<AdjustmentRecord | null> {
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(ADJUSTMENT_COLS)} FROM finanalysis.adjustments
    WHERE id = ${id} LIMIT 1`;
  return rows.length
    ? rowToAdjustment(rows[0] as Record<string, unknown>)
    : null;
}

/* --------------------- financials loading (service) ----------------- */

/**
 * Page through listSets — the financials service caps limit at 50, so
 * a limit-200 request must be paged explicitly.
 */
async function listAllSets(opts: {
  companyId: string;
  status?: string;
  layer?: string;
}): Promise<StatementSet[]> {
  const all: StatementSet[] = [];
  let offset = 0;
  for (;;) {
    const { items, total } = await listSets({
      companyId: opts.companyId,
      status: opts.status,
      layer: opts.layer,
      limit: 50,
      offset,
    });
    all.push(...items);
    offset += items.length;
    if (!items.length || offset >= total) break;
  }
  return all;
}

/**
 * Load a company's posted, current statement sets (with lines) through
 * the financials service. Optionally restricted to one layer
 * ('reported' | 'adjusted').
 */
export async function loadCompanyPeriods(
  companyId: string,
  opts: { layer?: string } = {}
): Promise<AnalysisPeriodInput[]> {
  const sets = await listAllSets({
    companyId,
    status: "posted",
    layer: opts.layer,
  });
  const current = sets.filter((s) => s.isCurrent);
  const periods: AnalysisPeriodInput[] = [];
  for (const set of current) {
    const full = await getSet(set.id);
    if (full) periods.push({ set: full.set, lines: full.lines });
  }
  return periods.sort(byPeriodAsc);
}

/* ------------------------------ analysis ---------------------------- */

/**
 * Run a full analysis for a company: load posted current periods
 * (reported chain primary, adjusted sets alongside) + benchmarks +
 * industry via the platform service, run the engine, compute the
 * margin bridge from ACCEPTED adjustments for the latest reported set,
 * resolve the deal screen on the adjusted-else-reported EBITDA basis,
 * store the payload as the new current DRAFT analysis, and replace
 * still-'proposed' adjustments with the engine's fresh seeds (decided
 * rows are history and are preserved, linked seeds point at the NEW
 * analysis id).
 */
export async function runAnalysis(
  companyId: string,
  actor: string,
  trigger: string
): Promise<{ analysis: AnalysisRecord; payload: AnalysisPayload }> {
  await ensureFinanalysis();
  const db = sql();
  const cid = (companyId ?? "").trim();
  if (!cid) throw new Error("company_required");

  const reportedPeriods = await loadCompanyPeriods(cid, {
    layer: "reported",
  });
  const adjustedPeriods = await loadCompanyPeriods(cid, {
    layer: "adjusted",
  });
  const benchmarks = await listBenchmarks();

  // Industry: the platform CompanyCard field is `vertical`
  // (contract coordinator note). Dynamic import — the jobs executor
  // reaches this module dynamically, and this avoids a static cycle.
  let industry = "general";
  try {
    const { getCompanyDetail } = await import("../platform/service");
    const detail = await getCompanyDetail(cid);
    const vertical =
      detail?.company?.vertical ??
      (detail?.company as unknown as Record<string, unknown> | undefined)
        ?.industry;
    if (typeof vertical === "string" && vertical.trim()) {
      industry = vertical.trim();
    }
  } catch {
    /* industry falls back to 'general' */
  }

  const latest = latestPeriod(reportedPeriods);
  const reportedEbitda = latest ? lineVal(latest.lines, "ebitda") : null;

  // Accepted adjustments (all decided-accept history for the company;
  // each carries its reportedSetId) are passed TO the engine, which
  // builds the margin bridge from them + the adjusted sets.
  const acceptedRows = await db`
    SELECT ${db.unsafe(ADJUSTMENT_COLS)} FROM finanalysis.adjustments
    WHERE company_id = ${cid} AND status = 'accepted'
    ORDER BY created_at ASC`;
  const acceptedAll = acceptedRows.map((r) =>
    rowToAdjustment(r as Record<string, unknown>)
  );
  const acceptedAdjustments: AcceptedAdjustmentInput[] = acceptedAll
    .map((a): AcceptedAdjustmentInput | null => {
      const amt = a.decidedAmount ?? a.amount;
      if (amt === null) return null;
      return {
        label: a.label,
        amount: amt,
        direction: a.direction === "subtract" ? "subtract" : "add",
        reportedSetId: a.reportedSetId,
      };
    })
    .filter((x): x is AcceptedAdjustmentInput => x !== null);

  const engineResult = buildAnalysisPayload({
    companyId: cid,
    industry,
    periods: reportedPeriods,
    benchmarks,
    generatedAt: new Date().toISOString(),
    acceptedAdjustments,
    adjustedSets: adjustedPeriods,
  });
  const seeds: SuggestionSeed[] = engineResult.suggestionSeeds ?? [];
  let payload: AnalysisPayload = engineResult.payload;

  // Margin-bridge fallback: the engine normally builds the bridge from
  // the accepted adjustments + adjusted sets passed above. If it came
  // back null, compute it here from the accepted adjustments for the
  // LATEST reported set + the adjusted set based on it, so a stored
  // payload never silently drops decided adjustments.
  if (!payload.marginBridge && latest) {
    const acceptedForLatest = acceptedAll.filter(
      (a) => a.reportedSetId === latest.set.id
    );
    const adjustedForLatestFb =
      adjustedPeriods.find(
        (p) =>
          p.set.basedOnSetId === latest.set.id ||
          (p.set.seriesId === latest.set.seriesId &&
            p.set.periodEnd === latest.set.periodEnd)
      ) ?? null;
    if (acceptedForLatest.length || adjustedForLatestFb) {
      const items = acceptedForLatest
        .map((a) => {
          const amt = a.decidedAmount ?? a.amount;
          if (amt === null) return null;
          return {
            label: a.label,
            amount: a.direction === "subtract" ? -amt : amt,
          };
        })
        .filter((x): x is { label: string; amount: number } => x !== null);
      const adjustedEbitdaFromBridge =
        reportedEbitda === null
          ? null
          : reportedEbitda + items.reduce((s, i) => s + i.amount, 0);
      const adjustedEbitdaFromSet = adjustedForLatestFb
        ? lineVal(adjustedForLatestFb.lines, "ebitda")
        : null;
      payload = {
        ...payload,
        marginBridge: {
          reportedSetId: latest.set.id,
          reportedEbitda,
          items,
          adjustedEbitda: adjustedEbitdaFromSet ?? adjustedEbitdaFromBridge,
          adjustedSetId: adjustedForLatestFb?.set.id ?? null,
        },
      };
    }
  }

  // Deal screen: the service resolves the EBITDA basis — adjusted
  // latest EBITDA when an adjusted current set exists for the latest
  // period, else reported latest (contract, dealscreen section).
  // computeDealScreen handles a null EBITDA (null grid), so this runs
  // unconditionally and the stored basis label is always the resolved
  // one.
  const adjustedForLatest = latest
    ? (adjustedPeriods.find(
        (p) =>
          p.set.basedOnSetId === latest.set.id ||
          (p.set.seriesId === latest.set.seriesId &&
            p.set.periodEnd === latest.set.periodEnd)
      ) ?? null)
    : null;
  const adjustedEbitda = adjustedForLatest
    ? lineVal(adjustedForLatest.lines, "ebitda")
    : null;
  payload = {
    ...payload,
    dealScreen: computeDealScreen({
      ebitda: adjustedEbitda ?? reportedEbitda,
      ebitdaBasis: adjustedEbitda !== null ? "adjusted" : "reported",
      assumptions: { ...DEFAULT_DEAL_SCREEN_ASSUMPTIONS },
    }),
  };

  // Integrity fallback: the engine payload normally carries the suite;
  // if it came back empty, run the suite here so the stored payload is
  // never silently missing its integrity section.
  if (!payload.integrity || payload.integrity.length === 0) {
    payload = {
      ...payload,
      integrity: runIntegritySuite(reportedPeriods),
    };
  }

  const inputSets = [
    ...reportedPeriods.map((p) => p.set),
    ...adjustedPeriods.map((p) => p.set),
  ];
  const fingerprint = fingerprintOf(inputSets);
  const inputs = {
    setIds: inputSets.map((s) => s.id),
    generatedFrom:
      trigger === "financials_posted" ? "financials_posted" : "manual",
  };

  const analysisId = newId();
  await db`
    UPDATE finanalysis.analyses
    SET is_current = false, updated_at = now()
    WHERE company_id = ${cid} AND is_current = true AND deleted_at IS NULL`;
  await db`
    INSERT INTO finanalysis.analyses
      (id, company_id, deal_id, status, is_current, input_fingerprint,
        inputs, data, created_by)
    VALUES (${analysisId}, ${cid}, ${latest?.set.dealId ?? null},
      'draft', true, ${fingerprint},
      ${JSON.stringify(inputs)}::jsonb,
      ${JSON.stringify(payload)}::jsonb, ${actor})`;

  // Replace still-'proposed' adjustments for the company (decided rows
  // are history — keep them); insert the fresh seeds linked to the NEW
  // analysis id.
  await db`
    DELETE FROM finanalysis.adjustments
    WHERE company_id = ${cid} AND status = 'proposed'`;
  for (const seed of seeds) {
    await db`
      INSERT INTO finanalysis.adjustments
        (id, analysis_id, company_id, reported_set_id, kind, label,
          amount, direction, rationale, source, requires_input, status)
      VALUES (${newId()}, ${analysisId}, ${cid}, ${seed.reportedSetId},
        ${seed.kind}, ${seed.label}, ${seed.amount},
        ${seed.direction}, ${seed.rationale},
        ${JSON.stringify(seed.source ?? {})}::jsonb,
        ${seed.requiresInput}, 'proposed')`;
  }

  const row = await fetchAnalysisRow(analysisId);
  if (!row) throw new Error("analysis_not_found");
  return { analysis: rowToAnalysis(row), payload };
}

/** Jobs executor entry (lib/platform/jobs.ts 'analyze_financials'). */
export async function runAnalysisJob(
  payload: Record<string, unknown>
): Promise<{ analysis: AnalysisRecord; payload: AnalysisPayload }> {
  const companyId = str(payload.companyId ?? payload.company_id);
  if (!companyId) throw new Error("company_required");
  const actor = str(payload.actor) || "system";
  const trigger = str(payload.trigger) || "financials_posted";
  return runAnalysis(companyId, actor, trigger);
}

/** Workspace read: the current analysis (draft or approved) + payload. */
export async function getCurrentAnalysis(
  companyId: string
): Promise<{ analysis: AnalysisRecord; payload: AnalysisPayload } | null> {
  await ensureFinanalysis();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(ANALYSIS_COLS)}, data FROM finanalysis.analyses
    WHERE company_id = ${companyId} AND is_current = true
      AND deleted_at IS NULL
    ORDER BY created_at DESC LIMIT 1`;
  if (!rows.length) return null;
  const row = rows[0] as Record<string, unknown>;
  return { analysis: rowToAnalysis(row), payload: jsonPayload(row.data) };
}

/**
 * Published read (cross-module surface): the payload ONLY when an
 * approved analysis exists — never draft data. Returns the latest
 * approved analysis's payload so a newer unapproved draft does not
 * unpublish the last approved one.
 */
export async function getPublishedAnalysis(
  companyId: string
): Promise<AnalysisPayload | null> {
  await ensureFinanalysis();
  const db = sql();
  const rows = await db`
    SELECT data FROM finanalysis.analyses
    WHERE company_id = ${companyId} AND status = 'approved'
      AND deleted_at IS NULL
    ORDER BY approved_at DESC NULLS LAST, created_at DESC LIMIT 1`;
  if (!rows.length) return null;
  return jsonPayload((rows[0] as Record<string, unknown>).data);
}

/** Published working-capital data; available ONLY post-approval. */
export async function getWorkingCapital(
  companyId: string
): Promise<
  | { available: true; data: WorkingCapitalData }
  | { available: false; reason: string }
> {
  const payload = await getPublishedAnalysis(companyId);
  if (!payload) {
    return { available: false, reason: "no_approved_analysis" };
  }
  return { available: true, data: payload.workingCapital };
}

/** Alias named in the contract's ground rules for the same surface. */
export const getWorkingCapitalForCompany = getWorkingCapital;

/**
 * Approve an analysis for publication: status approved, and the
 * sign-off fields (reviewed_by/at + approved_by/at = actor / now)
 * that render "Reviewed by ___ on ___ - Approved to publish".
 */
export async function approveAnalysis(
  id: string,
  actor: string
): Promise<AnalysisRecord> {
  await ensureFinanalysis();
  const db = sql();
  const existing = await fetchAnalysisRow(id);
  if (!existing) throw new Error("analysis_not_found");
  await db`
    UPDATE finanalysis.analyses
    SET status = 'approved', reviewed_by = ${actor}, reviewed_at = now(),
        approved_by = ${actor}, approved_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL`;
  const row = await fetchAnalysisRow(id);
  if (!row) throw new Error("analysis_not_found");
  return rowToAnalysis(row);
}

/** Soft-delete an analysis (cleanup + symmetry with Phase 4 sets). */
export async function deleteAnalysis(
  id: string,
  actor: string
): Promise<boolean> {
  void actor;
  await ensureFinanalysis();
  const db = sql();
  const rows = await db`
    UPDATE finanalysis.analyses
    SET deleted_at = now(), is_current = false, updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}

/* ----------------------------- benchmarks --------------------------- */

export async function listBenchmarks(
  industry?: string
): Promise<BenchmarkRecord[]> {
  await ensureFinanalysis();
  const db = sql();
  const ind = (industry ?? "").trim();
  const rows = await db`
    SELECT ${db.unsafe(BENCHMARK_COLS)} FROM finanalysis.benchmarks
    WHERE deleted_at IS NULL
      AND (${ind} = '' OR industry = ${ind})
    ORDER BY industry ASC, metric_key ASC`;
  return rows.map((r) => rowToBenchmark(r as Record<string, unknown>));
}

export async function upsertBenchmark(
  input: BenchmarkInput,
  actor: string
): Promise<BenchmarkRecord> {
  await ensureFinanalysis();
  const db = sql();
  const industry = (input.industry ?? "").trim() || "general";
  const metricKey = (input.metricKey ?? "").trim();
  if (!metricKey) throw new Error("metric_key_required");
  const source = (input.source ?? "").trim() || "manual";

  let existingId = (input.id ?? "").trim();
  if (!existingId) {
    const found = await db`
      SELECT id FROM finanalysis.benchmarks
      WHERE industry = ${industry} AND metric_key = ${metricKey}
        AND deleted_at IS NULL
      ORDER BY created_at ASC LIMIT 1`;
    if (found.length) existingId = str(found[0].id);
  }

  if (existingId) {
    await db`
      UPDATE finanalysis.benchmarks
      SET industry = ${industry}, metric_key = ${metricKey},
          median = ${input.median ?? null}, p25 = ${input.p25 ?? null},
          p75 = ${input.p75 ?? null},
          sample_size = ${input.sampleSize ?? null},
          source = ${source}, note = ${input.note ?? ""},
          updated_by = ${actor}, updated_at = now()
      WHERE id = ${existingId} AND deleted_at IS NULL`;
    const rows = await db`
      SELECT ${db.unsafe(BENCHMARK_COLS)} FROM finanalysis.benchmarks
      WHERE id = ${existingId} LIMIT 1`;
    if (!rows.length) throw new Error("benchmark_not_found");
    return rowToBenchmark(rows[0] as Record<string, unknown>);
  }

  const id = newId();
  await db`
    INSERT INTO finanalysis.benchmarks
      (id, industry, metric_key, median, p25, p75, sample_size, source,
        note, updated_by)
    VALUES (${id}, ${industry}, ${metricKey}, ${input.median ?? null},
      ${input.p25 ?? null}, ${input.p75 ?? null},
      ${input.sampleSize ?? null}, ${source}, ${input.note ?? ""},
      ${actor})`;
  const rows = await db`
    SELECT ${db.unsafe(BENCHMARK_COLS)} FROM finanalysis.benchmarks
    WHERE id = ${id} LIMIT 1`;
  return rowToBenchmark(rows[0] as Record<string, unknown>);
}

export async function deleteBenchmark(id: string): Promise<boolean> {
  await ensureFinanalysis();
  const db = sql();
  const rows = await db`
    UPDATE finanalysis.benchmarks
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}

/** Minimal CSV parser (quotes, escaped quotes, CRLF) for benchmark import. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function csvNum(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
}

/**
 * Import benchmarks from CSV. Header (case-insensitive, spaces
 * tolerated): industry,metric_key,median,p25,p75,sample_size,note.
 * Rows upsert on (industry, metric_key) with source 'csv'.
 */
export async function importBenchmarksCsv(
  text: string,
  actor: string
): Promise<{ created: number; updated: number; errors: string[] }> {
  await ensureFinanalysis();
  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  const rows = parseCsv(text ?? "");
  if (!rows.length) {
    return { created, updated, errors: ["empty_csv"] };
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const idx = {
    industry: col("industry"),
    metricKey: col("metric_key"),
    median: col("median"),
    p25: col("p25"),
    p75: col("p75"),
    sampleSize: col("sample_size"),
    note: col("note"),
  };
  if (idx.metricKey < 0) {
    return { created, updated, errors: ["metric_key_column_required"] };
  }
  const cellAt = (r: string[], i: number) =>
    i >= 0 && i < r.length ? r[i] : undefined;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 1;
    try {
      const metricKey = (cellAt(r, idx.metricKey) ?? "").trim();
      if (!metricKey) {
        errors.push(`row ${rowNo}: metric_key_required`);
        continue;
      }
      const industry =
        (cellAt(r, idx.industry) ?? "").trim() || "general";
      const existing = await listBenchmarks(industry);
      const isUpdate = existing.some((b) => b.metricKey === metricKey);
      const sample = csvNum(cellAt(r, idx.sampleSize));
      await upsertBenchmark(
        {
          industry,
          metricKey,
          median: csvNum(cellAt(r, idx.median)),
          p25: csvNum(cellAt(r, idx.p25)),
          p75: csvNum(cellAt(r, idx.p75)),
          sampleSize: sample === null ? null : Math.trunc(sample),
          source: "csv",
          note: (cellAt(r, idx.note) ?? "").trim(),
        },
        actor
      );
      if (isUpdate) updated++;
      else created++;
    } catch (err) {
      errors.push(
        `row ${rowNo}: ${err instanceof Error ? err.message : "import_failed"}`
      );
    }
  }
  return { created, updated, errors };
}

/* ----------------------------- adjustments -------------------------- */

/** All adjustments for a company (the UI adjustment log), newest first. */
export async function getCompanyAdjustments(
  companyId: string
): Promise<AdjustmentRecord[]> {
  await ensureFinanalysis();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(ADJUSTMENT_COLS)} FROM finanalysis.adjustments
    WHERE company_id = ${companyId}
    ORDER BY created_at DESC
    LIMIT 200`;
  return rows.map((r) => rowToAdjustment(r as Record<string, unknown>));
}

/**
 * Decide a suggested adjustment.
 *
 * Reject: status rejected, decided_* set.
 * Accept: resolve the final amount, then apply it to the adjusted
 * (QoE) layer ONLY, via the financials service:
 *   final amount = `amount` when supplied; else, for requiresInput
 *   kinds, stated - inputValue, where stated is source.statedAmount
 *   (the seed's originating line value, stored in the seed row's
 *   source JSON by the engine); else the seed amount. When the final
 *   amount is still null, throws Error('amount_required') — including
 *   when a requiresInput seed carries no statedAmount and no amount
 *   was supplied in the decide call.
 *   The adjusted draft for the reported set's series is reused (newest
 *   draft) or created via createAdjustedDraft; its EBITDA line moves
 *   by the signed amount and one 'QoE: <label>' opex_detail line is
 *   appended with the inverse expense effect — the full line list goes
 *   through updateSet (which recomputes derived lines + checks; an
 *   ebitda_variance on the QoE draft is EXPECTED — the variance IS the
 *   adjustment).
 * After either decision, an analyze_financials job is enqueued so the
 * margin bridge reflects the decision on the next run.
 */
export async function decideAdjustment(
  id: string,
  input: {
    decision: string;
    amount?: number | null;
    inputValue?: number | null;
  },
  actor: string
): Promise<AdjustmentRecord> {
  await ensureFinanalysis();
  const db = sql();
  const row = await fetchAdjustmentRow(id);
  if (!row) throw new Error("adjustment_not_found");
  if (row.status !== "proposed") {
    throw new Error("adjustment_already_decided");
  }
  const decision = (input.decision ?? "").trim().toLowerCase();

  if (decision === "reject" || decision === "rejected") {
    await db`
      UPDATE finanalysis.adjustments
      SET status = 'rejected', decided_by = ${actor}, decided_at = now(),
          decided_amount = ${input.amount ?? null}, updated_at = now()
      WHERE id = ${id}`;
  } else if (decision === "accept" || decision === "accepted") {
    // --- resolve the final amount --------------------------------
    let finalAmount: number | null =
      input.amount !== undefined && input.amount !== null
        ? num(input.amount)
        : null;
    if (finalAmount === null && row.requiresInput) {
      const statedRaw = row.source.statedAmount;
      const stated =
        typeof statedRaw === "number" && isFinite(statedRaw)
          ? statedRaw
          : null;
      if (
        stated !== null &&
        input.inputValue !== undefined &&
        input.inputValue !== null
      ) {
        finalAmount = stated - num(input.inputValue);
      }
      // stated absent, or inputValue not supplied, and no `amount`
      // in the call -> falls through to amount_required below.
    }
    if (finalAmount === null && !row.requiresInput) {
      finalAmount = row.amount;
    }
    if (finalAmount === null) throw new Error("amount_required");

    // --- apply to the adjusted layer via the financials service ---
    const reportedFull = await getSet(row.reportedSetId);
    if (!reportedFull) throw new Error("reported_set_not_found");
    const reported = reportedFull.set;
    if (reported.status !== "posted") {
      throw new Error("reported_not_posted");
    }
    if (reported.layer !== "reported") throw new Error("not_reported");

    const draftSets = await listAllSets({
      companyId: row.companyId,
      status: "draft",
      layer: "adjusted",
    });
    const reusable = draftSets
      .filter((s) => s.seriesId === reported.seriesId)
      .sort((a, b) => {
        if (b.version !== a.version) return b.version - a.version;
        return b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0;
      })[0];
    const adjustedDraftId = reusable
      ? reusable.id
      : (await createAdjustedDraft(row.reportedSetId, actor)).set.id;

    const draftFull = await getSet(adjustedDraftId);
    if (!draftFull) throw new Error("adjusted_draft_not_found");
    const signed = row.direction === "subtract" ? -finalAmount : finalAmount;
    let ebitdaPatched = false;
    const linePatches: LinePatch[] = draftFull.lines.map((l) => {
      const isEbitda = !ebitdaPatched && l.lineKey === "ebitda";
      if (isEbitda) ebitdaPatched = true;
      return {
        id: l.id,
        statementKind: l.statementKind,
        lineKey: l.lineKey,
        label: l.label,
        value: isEbitda ? (l.value ?? 0) + signed : l.value,
        rawValue: l.rawValue,
        confidence: l.confidence,
        source: l.source,
        sort: l.sort,
        isSubtotal: l.isSubtotal,
      };
    });
    if (!ebitdaPatched) {
      linePatches.push({
        statementKind: "is",
        lineKey: "ebitda",
        label: "EBITDA",
        value: signed,
        rawValue: null,
        confidence: null,
        source: row.source,
        sort: linePatches.length,
        isSubtotal: false,
      });
    }
    linePatches.push({
      statementKind: "is",
      lineKey: "opex_detail",
      label: `QoE: ${row.label}`,
      value: row.direction === "subtract" ? finalAmount : -finalAmount,
      rawValue: null,
      confidence: null,
      source: row.source,
      sort: linePatches.length,
      isSubtotal: false,
    });

    await updateSet(adjustedDraftId, { lines: linePatches, actor });

    await db`
      UPDATE finanalysis.adjustments
      SET status = 'accepted', decided_by = ${actor}, decided_at = now(),
          decided_amount = ${finalAmount},
          adjusted_set_id = ${adjustedDraftId}, updated_at = now()
      WHERE id = ${id}`;
  } else {
    throw new Error("invalid_decision");
  }

  // Re-run analysis so the margin bridge reflects the decision.
  try {
    await enqueueJob("analyze_financials", {
      companyId: row.companyId,
      trigger: "adjustment_decided",
    });
  } catch {
    /* the decision stands; the job queue is retried by other drains */
  }

  const saved = await fetchAdjustmentRow(id);
  if (!saved) throw new Error("adjustment_not_found");
  return saved;
}

/* ------------------------------ integrity --------------------------- */

/**
 * Live integrity suite for the review screen: posted current sets for
 * the company PLUS the named draft set (fetched via getSet regardless
 * of status; a draft already among the posted periods is not
 * duplicated).
 */
export async function getIntegrityLive(
  companyId: string,
  draftSetId?: string
): Promise<IntegrityCheckResult[]> {
  await ensureFinanalysis();
  const periods = await loadCompanyPeriods(companyId);
  if (draftSetId) {
    const draft = await getSet(draftSetId);
    if (draft && draft.set.companyId === companyId) {
      const existingIdx = periods.findIndex(
        (p) => p.set.id === draft.set.id
      );
      if (existingIdx >= 0) {
        periods[existingIdx] = { set: draft.set, lines: draft.lines };
      } else {
        periods.push({ set: draft.set, lines: draft.lines });
      }
    }
  }
  return runIntegritySuite(
    periods,
    draftSetId ? { draftSetId } : undefined
  );
}

/* ------------------------- event registration ----------------------- */
/**
 * On financials_posted, enqueue an analyze_financials job for the
 * company — unless one is already queued/running for the same company
 * (checked against core.jobs payload). postSet ALSO enqueues directly
 * (the guaranteed path); this handler covers posts from any other
 * path and dedupes against the direct enqueue. Registered once per
 * process, mirroring the financials service.
 */
let finanalysisHandlerRegistered = false;
function registerFinanalysisHandlers(): void {
  if (finanalysisHandlerRegistered) return;
  finanalysisHandlerRegistered = true;
  onEvent("financials_posted", async (evt) => {
    const payload = evt.payload ?? {};
    const cid =
      typeof payload.companyId === "string" && payload.companyId
        ? payload.companyId
        : evt.entityId;
    if (!cid) return;
    try {
      await ensureFinanalysis();
      const db = sql();
      const existing = await db`
        SELECT id FROM core.jobs
        WHERE kind = 'analyze_financials'
          AND status IN ('queued', 'running')
          AND payload->>'companyId' = ${cid}
        LIMIT 1`;
      if (existing.length) return;
      await enqueueJob("analyze_financials", {
        companyId: cid,
        trigger: "financials_posted",
        actor: evt.actor ?? "",
      });
    } catch (err) {
      console.error(
        "[finanalysis] onEvent analyze enqueue failed for company",
        cid,
        err instanceof Error ? err.message : String(err)
      );
    }
  });
}
registerFinanalysisHandlers();
