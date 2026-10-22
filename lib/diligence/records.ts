import {
  sql,
  newId,
  str,
  num,
  isoOrNull,
  normalizeName,
} from "../platform/db";
import { enqueueJobAt } from "../platform/jobs";
import { ensureAutomation } from "./automation-schema";

/**
 * Public-record checks (Part 5B) — snapshot history per company for
 * UCC filings, entity status, litigation, liens & judgments, and
 * licenses.
 *
 * Honesty rules (standing):
 * - Four of the five check types have NO automatable public source
 *   (interactive state portals, a human-check-gated ACC eCorp, paid
 *   PACER, per-county recorders). They are manual snapshot entries —
 *   the CHECK_TYPES metadata says so on the record, and nothing here
 *   pretends to scrape them.
 * - The one internal route ('licenses') derives from data the
 *   platform ALREADY ingests: lib/adhs-ingest.ts stamps matched
 *   Healthcare mi_companies rows with details.adhsLicenseCount /
 *   adhsFacilities / adhsUnits / adhsDataAsOf (YYYY-MM) /
 *   adhsCategories / adhsMatchBasis. A company with no ADHS footprint
 *   still gets a snapshot — result 'unknown' with an explicit
 *   honest-negative summary — never a fabricated 'clear'.
 *
 * Cross-module note: mi_companies is legacy Market Intel reference
 * data on the same platform database (adhs-ingest.ts itself reads and
 * stamps it); core.companies is shared platform reference data. Both
 * are read here read-only; diligence writes stay in `diligence`.
 */

const DAY_MS = 86400000;

function jsonObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v))
    return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

/* ----------------------------- check types ---------------------------- */

export interface CheckTypeMeta {
  key: string;
  label: string;
  defaultSource: string;
  automation: "manual" | "internal";
  automationNote: string;
}

export const CHECK_TYPES: CheckTypeMeta[] = [
  {
    key: "ucc",
    label: "UCC filings",
    defaultSource: "Arizona Secretary of State — UCC Central Filing",
    automation: "manual",
    automationNote:
      "No public API; the state UCC search portal is interactive-only. Manual snapshot entry.",
  },
  {
    key: "sos_status",
    label: "Entity status (Secretary of State / ACC)",
    defaultSource: "Arizona Corporation Commission — eCorp",
    automation: "manual",
    automationNote:
      "ACC eCorp is human-check gated (standing rule: no automated login). Manual snapshot entry.",
  },
  {
    key: "litigation",
    label: "Litigation",
    defaultSource: "PACER / Arizona Courts",
    automation: "manual",
    automationNote:
      "PACER requires a paid account; AZ court portals are interactive. Manual snapshot entry.",
  },
  {
    key: "liens_judgments",
    label: "Liens & judgments",
    defaultSource: "County Recorder / court records",
    automation: "manual",
    automationNote:
      "No unified API across AZ counties. Manual snapshot entry.",
  },
  {
    key: "licenses",
    label: "Licenses",
    defaultSource: "ADHS license databases (platform-ingested)",
    automation: "internal",
    automationNote:
      "Derived from the ADHS facility databases the platform already ingests monthly — see runAutomatedChecks.",
  },
];

const CHECK_TYPE_KEYS = new Set(CHECK_TYPES.map((t) => t.key));
export const checkTypeMeta = (key: string): CheckTypeMeta | undefined =>
  CHECK_TYPES.find((t) => t.key === key);

/* ------------------------------- rows --------------------------------- */

export interface RecordCheckRow {
  id: string;
  companyId: string;
  dealId: string | null;
  workspaceId: string | null;
  checkType: string;
  sourceName: string;
  sourceUrl: string;
  route: string;
  resultStatus: string;
  summary: string;
  details: Record<string, unknown>;
  checkedAt: string;
  enteredBy: string;
  prevSnapshotId: string | null;
  changed: boolean;
  changeSummary: string;
  createdAt: string;
}

function rowToCheck(r: Record<string, unknown>): RecordCheckRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    dealId: r.deal_id ? str(r.deal_id) : null,
    workspaceId: r.workspace_id ? str(r.workspace_id) : null,
    checkType: str(r.check_type),
    sourceName: str(r.source_name),
    sourceUrl: str(r.source_url),
    route: str(r.route) || "manual",
    resultStatus: str(r.result_status) || "unknown",
    summary: str(r.summary),
    details: jsonObj(r.details),
    checkedAt: isoOrNull(r.checked_at) ?? "",
    enteredBy: str(r.entered_by),
    prevSnapshotId: r.prev_snapshot_id ? str(r.prev_snapshot_id) : null,
    changed: Boolean(r.changed),
    changeSummary: str(r.change_summary),
    createdAt: isoOrNull(r.created_at) ?? "",
  };
}

const CHECK_COLS = `id, company_id, deal_id, workspace_id, check_type,
  source_name, source_url, route, result_status, summary, details,
  checked_at, entered_by, prev_snapshot_id, changed, change_summary,
  created_at`;

/* ---------------------------- snapshots ------------------------------- */

export interface CreateSnapshotInput {
  companyId: string;
  dealId?: string | null;
  workspaceId?: string | null;
  checkType: string;
  sourceName: string;
  sourceUrl?: string;
  route: string;
  resultStatus: string;
  summary: string;
  details?: Record<string, unknown>;
}

const normSummary = (s: string): string =>
  s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Append a check snapshot. The prior snapshot for (company, check_type)
 * is linked via prev_snapshot_id; `changed` is true only when a prior
 * exists AND the verdict or the (whitespace/case-normalized) summary
 * actually moved — a re-check that confirms the same state is history,
 * not a change.
 */
export async function createSnapshot(
  input: CreateSnapshotInput,
  actor: string
): Promise<RecordCheckRow> {
  await ensureAutomation();
  const companyId = (input.companyId ?? "").trim();
  if (!companyId) throw new Error("company_required");
  if (!CHECK_TYPE_KEYS.has(input.checkType))
    throw new Error("check_type_invalid");
  const route = input.route === "automated" ? "automated" : "manual";
  const resultStatus = ["clear", "finding", "unknown"].includes(
    input.resultStatus
  )
    ? input.resultStatus
    : "unknown";
  const db = sql();
  const priorRows = await db`
    SELECT ${db.unsafe(CHECK_COLS)} FROM diligence.record_checks
    WHERE company_id = ${companyId} AND check_type = ${input.checkType}
      AND deleted_at IS NULL
    ORDER BY checked_at DESC, created_at DESC LIMIT 1`;
  const prior = priorRows.length
    ? rowToCheck(priorRows[0] as Record<string, unknown>)
    : null;
  let changed = false;
  const changeParts: string[] = [];
  if (prior) {
    if (prior.resultStatus !== resultStatus) {
      changed = true;
      changeParts.push(
        `Status changed ${prior.resultStatus} → ${resultStatus}`
      );
    }
    if (normSummary(prior.summary) !== normSummary(input.summary ?? "")) {
      changed = true;
      changeParts.push("Summary updated");
    }
  }
  const id = `rck_${newId()}`;
  await db`
    INSERT INTO diligence.record_checks
      (id, company_id, deal_id, workspace_id, check_type, source_name,
       source_url, route, result_status, summary, details, checked_at,
       entered_by, prev_snapshot_id, changed, change_summary)
    VALUES (${id}, ${companyId}, ${input.dealId ?? null},
      ${input.workspaceId ?? null}, ${input.checkType},
      ${(input.sourceName ?? "").trim()},
      ${(input.sourceUrl ?? "").trim()}, ${route}, ${resultStatus},
      ${(input.summary ?? "").trim()},
      ${JSON.stringify(input.details ?? {})}::jsonb, now(), ${actor},
      ${prior ? prior.id : null}, ${changed}, ${changeParts.join("; ")})`;
  const rows = await db`
    SELECT ${db.unsafe(CHECK_COLS)} FROM diligence.record_checks
    WHERE id = ${id} LIMIT 1`;
  return rowToCheck(rows[0] as Record<string, unknown>);
}

export interface LatestCheckEntry {
  meta: CheckTypeMeta;
  latest: RecordCheckRow | null;
  /** True when the newest snapshot is older than the route's window
   * (manual 30d, internal 35d — the ADHS ingest is monthly) or when no
   * snapshot exists at all. */
  refreshDue: boolean;
}

export async function listLatestChecks(
  companyId: string
): Promise<LatestCheckEntry[]> {
  await ensureAutomation();
  const db = sql();
  const rows = await db`
    SELECT DISTINCT ON (check_type) ${db.unsafe(CHECK_COLS)}
    FROM diligence.record_checks
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY check_type, checked_at DESC, created_at DESC`;
  const byType = new Map<string, RecordCheckRow>();
  for (const r of rows)
    byType.set(
      str((r as Record<string, unknown>).check_type),
      rowToCheck(r as Record<string, unknown>)
    );
  const now = Date.now();
  return CHECK_TYPES.map((meta) => {
    const latest = byType.get(meta.key) ?? null;
    const windowDays = meta.automation === "internal" ? 35 : 30;
    const refreshDue =
      !latest ||
      now - new Date(latest.checkedAt).getTime() > windowDays * DAY_MS;
    return { meta, latest, refreshDue };
  });
}

export async function listSnapshots(
  companyId: string,
  checkType?: string
): Promise<RecordCheckRow[]> {
  await ensureAutomation();
  const db = sql();
  const type = (checkType ?? "").trim();
  const rows = await db`
    SELECT ${db.unsafe(CHECK_COLS)} FROM diligence.record_checks
    WHERE company_id = ${companyId} AND deleted_at IS NULL
      AND (${type} = '' OR check_type = ${type})
    ORDER BY checked_at DESC, created_at DESC
    LIMIT 50`;
  return rows.map((r) => rowToCheck(r as Record<string, unknown>));
}

/* --------------------- automated route: ADHS licenses ------------------ */

export const ADHS_SOURCE_NAME = "ADHS license databases (platform-ingested)";
export const ADHS_SOURCE_URL =
  "https://www.azdhs.gov/licensing/index.php#databases";

interface AdhsFootprint {
  matchedRows: number;
  licenseCount: number;
  facilities: number;
  units: number;
  dataAsOf: string;
  categories: string[];
  matchBasis: string;
}

/**
 * Aggregate the ADHS stamp across every mi_companies row whose
 * normalized name matches the core company's. core.companies has no
 * link to mi_companies for fit-sourced rows beyond legacy_mi_id, and
 * spine rows are re-keyed on rebuilds, so name matching (the same
 * normalizeName the platform dedupes on) is the durable join.
 */
/**
 * Returns { ok:false } ONLY when the mi_companies read itself threw
 * (table/shape unavailable) — a successful read with no name match is
 * { ok:true } with a zeroed footprint, which the caller turns into the
 * honest-negative 'unknown' snapshot. The two must never be conflated:
 * a broken read must not become a verdict, and a true negative must
 * not be reported as a broken read.
 */
async function adhsFootprintFor(
  normalized: string
): Promise<{ ok: true; footprint: AdhsFootprint } | { ok: false }> {
  const db = sql();
  let rows: Record<string, unknown>[];
  try {
    // Only ADHS-stamped rows can match; the stamped universe is the
    // healthcare operator groups (hundreds of rows), capped generously
    // so a match is never silently truncated away.
    rows = (await db`
      SELECT name, details FROM mi_companies
      WHERE details LIKE '%"adhsLicenseCount"%'
      LIMIT 5000`) as Record<string, unknown>[];
  } catch {
    return { ok: false };
  }
  const agg: AdhsFootprint = {
    matchedRows: 0,
    licenseCount: 0,
    facilities: 0,
    units: 0,
    dataAsOf: "",
    categories: [],
    matchBasis: "",
  };
  const categories = new Set<string>();
  const bases = new Set<string>();
  for (const r of rows) {
    if (normalizeName(str(r.name)) !== normalized) continue;
    const d = jsonObj(typeof r.details === "string" ? safeParse(r.details) : r.details);
    const licenseCount = num(d.adhsLicenseCount);
    if (licenseCount <= 0 && !d.adhsDataAsOf) continue;
    agg.matchedRows += 1;
    agg.licenseCount += licenseCount;
    agg.facilities += num(d.adhsFacilities);
    agg.units += num(d.adhsUnits);
    const asOf = str(d.adhsDataAsOf);
    if (asOf > agg.dataAsOf) agg.dataAsOf = asOf;
    if (Array.isArray(d.adhsCategories))
      for (const c of d.adhsCategories) categories.add(str(c));
    if (str(d.adhsMatchBasis)) bases.add(str(d.adhsMatchBasis));
  }
  agg.categories = Array.from(categories).sort();
  agg.matchBasis = Array.from(bases).sort().join("+");
  return { ok: true, footprint: agg };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/**
 * The 'licenses' internal route. Resolves the core company, matches it
 * against the platform's ADHS-stamped mi_companies rows, and records a
 * snapshot either way:
 * - ≥1 active license in the ingested data → 'clear' with the counts.
 * - No ADHS footprint → 'unknown' with an explicit honest-negative
 *   summary (expected for non-healthcare targets).
 * Returns { ran:false, reason } — and writes NOTHING — when the
 * company cannot be resolved or the mi_companies read is impossible,
 * so a broken read never becomes a fabricated verdict.
 */
export async function runAutomatedChecks(
  companyId: string,
  actor: string
): Promise<
  | { ran: true; snapshot: RecordCheckRow }
  | { ran: false; reason: string }
> {
  await ensureAutomation();
  const db = sql();
  const compRows = await db`
    SELECT id, name, normalized_name FROM core.companies
    WHERE id = ${companyId} AND deleted_at IS NULL LIMIT 1`;
  if (!compRows.length) return { ran: false, reason: "company_not_found" };
  const comp = compRows[0] as Record<string, unknown>;
  const companyName = str(comp.name);
  const normalized =
    str(comp.normalized_name) || normalizeName(companyName);
  if (!normalized) return { ran: false, reason: "company_name_missing" };

  const res = await adhsFootprintFor(normalized);
  if (!res.ok) {
    // The mi_companies read itself failed (table/shape unavailable) —
    // write NOTHING rather than fabricate a verdict.
    return { ran: false, reason: "mi_companies_unavailable" };
  }
  return {
    ran: true,
    snapshot: await snapshotFromFootprint(companyId, res.footprint, actor),
  };
}

async function snapshotFromFootprint(
  companyId: string,
  footprint: AdhsFootprint,
  actor: string
): Promise<RecordCheckRow> {
  const found = footprint.licenseCount > 0;
  const summary = found
    ? `${footprint.licenseCount} active ADHS license(s) across ` +
      `${footprint.facilities} facilit${footprint.facilities === 1 ? "y" : "ies"}` +
      ` (${footprint.units.toLocaleString("en-US")} licensed units) in the ` +
      `platform's ingested ADHS data as of ${footprint.dataAsOf || "the latest snapshot"}.`
    : "No ADHS-licensed facilities matched this company in the platform's ingested ADHS data (expected for non-healthcare targets).";
  return createSnapshot(
    {
      companyId,
      checkType: "licenses",
      sourceName: ADHS_SOURCE_NAME,
      sourceUrl: ADHS_SOURCE_URL,
      route: "automated",
      resultStatus: found ? "clear" : "unknown",
      summary,
      details: {
        licenseCount: footprint.licenseCount,
        facilities: footprint.facilities,
        units: footprint.units,
        dataAsOf: footprint.dataAsOf || null,
        categories: footprint.categories,
        matchBasis: footprint.matchBasis || null,
        matchedMiRows: footprint.matchedRows,
      },
    },
    actor
  );
}

/* --------------------------- monthly refresh --------------------------- */

/**
 * Refresh the automated checks for every company that has a diligence
 * workspace or any prior record check. Manual-route types are NOT
 * touched — there is no honest automated source for them.
 */
export async function runMonthlyRefresh(
  actor: string
): Promise<{ companies: number; snapshots: number }> {
  await ensureAutomation();
  const db = sql();
  const rows = await db`
    SELECT company_id FROM (
      SELECT company_id FROM diligence.workspaces
        WHERE deleted_at IS NULL AND company_id IS NOT NULL
      UNION
      SELECT company_id FROM diligence.record_checks
        WHERE deleted_at IS NULL
    ) u ORDER BY company_id ASC`;
  let snapshots = 0;
  for (const r of rows) {
    const companyId = str((r as Record<string, unknown>).company_id);
    if (!companyId) continue;
    const res = await runAutomatedChecks(companyId, actor).catch(() => null);
    if (res && res.ran) snapshots += 1;
  }
  return { companies: rows.length, snapshots };
}

/**
 * Self-perpetuating monthly job registration: if no queued
 * refresh_record_checks job exists, enqueue the next run 30 days out.
 * Mirrors ensureMorningDigestJob's pattern in lib/push-schedule.ts;
 * the coordinator wires the job kind in lib/platform/jobs.ts.
 */
export async function ensureRecordChecksJob(): Promise<void> {
  await ensureAutomation();
  const db = sql();
  const rows = await db`
    SELECT id FROM core.jobs
    WHERE kind = 'refresh_record_checks' AND status = 'queued'
    LIMIT 1`;
  if (rows.length) return;
  await enqueueJobAt(
    "refresh_record_checks",
    { monthly: true, actor: "system" },
    new Date(Date.now() + 30 * DAY_MS)
  );
}

/** Job handler (kind 'refresh_record_checks') — wired by the coordinator. */
export async function runRecordRefreshJob(
  payload: Record<string, unknown>
): Promise<{ companies: number; snapshots: number }> {
  const actor = str(payload.actor) || "system";
  const result = await runMonthlyRefresh(actor);
  await ensureRecordChecksJob();
  return result;
}
