import { sql, newId, str, num, numOrNull, isoOrNull } from "../platform/db";
import {
  ensureCapital,
  REPORT_ENTRY_TYPES,
  MONITORING_PENDING_MARKER,
} from "./schema";
import { getDealContext } from "../diligence/service";
import { getDirectoryDetail } from "../directory/service";
// WS-A's capital service owns capital.deal_summary; every report
// write refreshes it through this service function (never raw SQL
// against another workstream's logic — deal_summary is refreshed,
// not recomputed, here).
import { refreshDealSummary } from "./service";

/**
 * Investor reporting (Phase 7, WS-B) — capital.report_entries CRUD,
 * per-deal totals, and report templates with placeholder rendering.
 *
 * Investor identity resolves ONLY through the Directory service
 * (getDirectoryDetail) — names are never copied into this module's
 * tables. Entry validation: entryType ∈ REPORT_ENTRY_TYPES
 * (invalid_entry_type); amount must be a finite number (invalid_amount)
 * — NAV may be any value, capital_call / distribution must be ≥ 0.
 *
 * Template rendering substitutes via split/join (never a RegExp
 * built from a string — see the Phase 5 regex-literal rule). Unknown
 * placeholders are left as-is. {{monitoring_section}} renders the
 * Phase 8 pending marker verbatim — an honest empty state, never a
 * fabricated KPI.
 */

function dateOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s ? s.slice(0, 10) : null;
}
function cleanDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** $X,XXX with no decimals; negatives render -$X,XXX. */
export function fmtMoney0(v: number): string {
  const rounded = Math.round(v);
  const s = Math.abs(rounded).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
  return rounded < 0 ? `-$${s}` : `$${s}`;
}

async function investorName(personId: string | null): Promise<string | null> {
  if (!personId) return null;
  try {
    const detail = await getDirectoryDetail("person", personId);
    const name = detail?.record?.name;
    return typeof name === "string" && name ? name : null;
  } catch {
    return null;
  }
}

async function resolveNames(
  personIds: Array<string | null>
): Promise<Map<string, string | null>> {
  const unique = Array.from(
    new Set(personIds.filter((x): x is string => Boolean(x)))
  );
  const map = new Map<string, string | null>();
  for (const id of unique) {
    map.set(id, await investorName(id));
  }
  return map;
}

/* ------------------------------ entries ------------------------------ */

export interface ReportEntry {
  id: string;
  dealId: string;
  investorPersonId: string | null;
  investorName: string | null;
  entryType: string;
  amount: number;
  asOf: string | null;
  notes: string;
  source: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const ENTRY_COLS = `id, deal_id, investor_person_id, entry_type, amount,
  as_of, notes, source, created_by, created_at, updated_at`;

function rowToEntry(
  r: Record<string, unknown>,
  names: Map<string, string | null>
): ReportEntry {
  const investorPersonId = r.investor_person_id
    ? str(r.investor_person_id)
    : null;
  return {
    id: str(r.id),
    dealId: str(r.deal_id),
    investorPersonId,
    investorName: investorPersonId
      ? (names.get(investorPersonId) ?? null)
      : null,
    entryType: str(r.entry_type),
    amount: num(r.amount),
    asOf: dateOrNull(r.as_of),
    notes: str(r.notes),
    source: str(r.source) || "manual",
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export interface ReportTotals {
  called: number;
  distributed: number;
  navLatest: number | null;
  byInvestor: Array<{
    personId: string;
    name: string | null;
    called: number;
    distributed: number;
    nav: number | null;
  }>;
}

export interface DealReporting {
  entries: ReportEntry[];
  totals: ReportTotals;
}

export async function getDealReporting(
  dealId: string
): Promise<DealReporting> {
  await ensureCapital();
  const ctx = await getDealContext(dealId);
  if (!ctx) throw new Error("deal_not_found");
  const db = sql();

  const entryRows = await db`
    SELECT ${db.unsafe(ENTRY_COLS)} FROM capital.report_entries
    WHERE deal_id = ${dealId} AND deleted_at IS NULL
    ORDER BY as_of DESC, created_at DESC LIMIT 200`;

  // Totals aggregate over ALL live entries (not just the 200 shown).
  const aggRows = await db`
    SELECT
      coalesce(sum(amount) FILTER (WHERE entry_type = 'capital_call'), 0) AS called,
      coalesce(sum(amount) FILTER (WHERE entry_type = 'distribution'), 0) AS distributed
    FROM capital.report_entries
    WHERE deal_id = ${dealId} AND deleted_at IS NULL`;
  const agg = (aggRows[0] ?? {}) as Record<string, unknown>;

  const navRows = await db`
    SELECT amount FROM capital.report_entries
    WHERE deal_id = ${dealId} AND deleted_at IS NULL AND entry_type = 'nav'
    ORDER BY as_of DESC, created_at DESC LIMIT 1`;

  const byInvRows = await db`
    SELECT investor_person_id,
      coalesce(sum(amount) FILTER (WHERE entry_type = 'capital_call'), 0) AS called,
      coalesce(sum(amount) FILTER (WHERE entry_type = 'distribution'), 0) AS distributed
    FROM capital.report_entries
    WHERE deal_id = ${dealId} AND deleted_at IS NULL
      AND investor_person_id IS NOT NULL
    GROUP BY investor_person_id`;

  const byInvestor: ReportTotals["byInvestor"] = [];
  for (const r of byInvRows) {
    const rec = r as Record<string, unknown>;
    const personId = str(rec.investor_person_id);
    const invNav = await db`
      SELECT amount FROM capital.report_entries
      WHERE deal_id = ${dealId} AND deleted_at IS NULL
        AND entry_type = 'nav' AND investor_person_id = ${personId}
      ORDER BY as_of DESC, created_at DESC LIMIT 1`;
    byInvestor.push({
      personId,
      name: null,
      called: num(rec.called),
      distributed: num(rec.distributed),
      nav: invNav.length
        ? num((invNav[0] as Record<string, unknown>).amount)
        : null,
    });
  }

  const names = await resolveNames([
    ...entryRows.map((r) =>
      (r as Record<string, unknown>).investor_person_id
        ? str((r as Record<string, unknown>).investor_person_id)
        : null
    ),
    ...byInvestor.map((b) => b.personId),
  ]);
  for (const b of byInvestor) b.name = names.get(b.personId) ?? null;
  byInvestor.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return {
    entries: entryRows.map((r) =>
      rowToEntry(r as Record<string, unknown>, names)
    ),
    totals: {
      called: num(agg.called),
      distributed: num(agg.distributed),
      navLatest: navRows.length
        ? num((navRows[0] as Record<string, unknown>).amount)
        : null,
      byInvestor,
    },
  };
}

/** Entries list alone (thin wrapper over getDealReporting). */
export async function listReportEntries(
  dealId: string
): Promise<ReportEntry[]> {
  return (await getDealReporting(dealId)).entries;
}

export interface ReportEntryInput {
  investorPersonId?: string | null;
  entryType?: string;
  amount?: number;
  asOf?: string | null;
  notes?: string;
  source?: string;
}

export async function createReportEntry(
  dealId: string,
  input: ReportEntryInput,
  actor: string
): Promise<ReportEntry> {
  await ensureCapital();
  const ctx = await getDealContext(dealId);
  if (!ctx) throw new Error("deal_not_found");
  const entryType = (input.entryType ?? "").trim();
  if (!(REPORT_ENTRY_TYPES as readonly string[]).includes(entryType)) {
    throw new Error("invalid_entry_type");
  }
  const amount = input.amount;
  if (typeof amount !== "number" || !isFinite(amount)) {
    throw new Error("invalid_amount");
  }
  // NAV can be any value; calls / distributions cannot be negative.
  if (entryType !== "nav" && amount < 0) {
    throw new Error("invalid_amount");
  }
  const investorPersonId =
    typeof input.investorPersonId === "string" && input.investorPersonId
      ? input.investorPersonId
      : null;
  const db = sql();
  const id = `rpe_${newId()}`;
  // as_of is NOT NULL with a CURRENT_DATE default — an absent/invalid
  // input date must become an explicit date, never an inserted NULL.
  const asOfDate =
    cleanDate(input.asOf) ?? new Date().toISOString().slice(0, 10);
  await db`
    INSERT INTO capital.report_entries
      (id, deal_id, investor_person_id, entry_type, amount, as_of, notes,
       source, created_by)
    VALUES (${id}, ${dealId}, ${investorPersonId}, ${entryType}, ${amount},
      ${asOfDate}, ${(input.notes ?? "").trim()},
      ${(input.source ?? "manual").trim() || "manual"}, ${actor})`;
  await refreshDealSummary(dealId);
  const rows = await db`
    SELECT ${db.unsafe(ENTRY_COLS)} FROM capital.report_entries
    WHERE id = ${id} LIMIT 1`;
  const names = await resolveNames([investorPersonId]);
  return rowToEntry(rows[0] as Record<string, unknown>, names);
}

export async function deleteReportEntry(
  dealId: string,
  entryId: string
): Promise<boolean> {
  await ensureCapital();
  const ctx = await getDealContext(dealId);
  if (!ctx) throw new Error("deal_not_found");
  const db = sql();
  const rows = await db`
    UPDATE capital.report_entries
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${entryId} AND deal_id = ${dealId} AND deleted_at IS NULL
    RETURNING id`;
  if (!rows.length) throw new Error("report_entry_not_found");
  await refreshDealSummary(dealId);
  return true;
}

/* ----------------------------- templates ----------------------------- */

export interface ReportTemplate {
  id: string;
  name: string;
  kind: string;
  body: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

const TEMPLATE_COLS = `id, name, kind, body, is_system, created_at, updated_at`;

function rowToTemplate(r: Record<string, unknown>): ReportTemplate {
  return {
    id: str(r.id),
    name: str(r.name),
    kind: str(r.kind),
    body: str(r.body),
    isSystem: r.is_system === true,
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function listReportTemplates(): Promise<ReportTemplate[]> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(TEMPLATE_COLS)} FROM capital.report_templates
    WHERE deleted_at IS NULL
    ORDER BY is_system DESC, name ASC`;
  return rows.map((r) => rowToTemplate(r as Record<string, unknown>));
}

export async function createReportTemplate(input: {
  name?: string;
  kind?: string;
  body?: string;
}): Promise<ReportTemplate> {
  await ensureCapital();
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("name_required");
  const db = sql();
  const id = `rpt_${newId()}`;
  await db`
    INSERT INTO capital.report_templates (id, name, kind, body, is_system)
    VALUES (${id}, ${name},
      ${(input.kind ?? "").trim() || "investor_update"},
      ${input.body ?? ""}, false)`;
  const rows = await db`
    SELECT ${db.unsafe(TEMPLATE_COLS)} FROM capital.report_templates
    WHERE id = ${id} LIMIT 1`;
  return rowToTemplate(rows[0] as Record<string, unknown>);
}

export async function getReportTemplate(
  templateId: string
): Promise<ReportTemplate | null> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(TEMPLATE_COLS)} FROM capital.report_templates
    WHERE id = ${templateId} AND deleted_at IS NULL LIMIT 1`;
  return rows.length
    ? rowToTemplate(rows[0] as Record<string, unknown>)
    : null;
}

/* ------------------------------ rendering ---------------------------- */

export interface RenderReportInput {
  dealId: string;
  templateId: string;
  investorPersonId?: string | null;
  asOf?: string;
}

export interface RenderReportResult {
  text: string;
  values: Record<string, string | number | null>;
}

export async function renderReport(
  input: RenderReportInput
): Promise<RenderReportResult> {
  await ensureCapital();
  const template = await getReportTemplate(input.templateId);
  if (!template) throw new Error("template_not_found");
  const ctx = await getDealContext(input.dealId);
  if (!ctx) throw new Error("deal_not_found");
  const dealId = input.dealId;
  const investorPersonId =
    typeof input.investorPersonId === "string" && input.investorPersonId
      ? input.investorPersonId
      : null;
  const db = sql();

  const investorNameVal =
    (investorPersonId ? await investorName(investorPersonId) : null) ??
    "Investor";
  const asOf =
    cleanDate(input.asOf) ?? new Date().toISOString().slice(0, 10);

  // Committed: Σ the investor's live, non-passed commitments on the
  // deal (deal-level total when no investor is given).
  const committedRows = await db`
    SELECT coalesce(sum(amount), 0) AS total FROM capital.commitments
    WHERE deal_id = ${dealId} AND deleted_at IS NULL
      AND stage <> 'passed'
      AND (${investorPersonId}::text IS NULL
        OR investor_person_id = ${investorPersonId})`;
  const committed = num(
    (committedRows[0] as Record<string, unknown> | undefined)?.total
  );

  const sumByType = async (entryType: string): Promise<number> => {
    const rows = await db`
      SELECT coalesce(sum(amount), 0) AS total FROM capital.report_entries
      WHERE deal_id = ${dealId} AND deleted_at IS NULL
        AND entry_type = ${entryType}
        AND (${investorPersonId}::text IS NULL
          OR investor_person_id = ${investorPersonId})`;
    return num((rows[0] as Record<string, unknown> | undefined)?.total);
  };
  const capitalCalled = await sumByType("capital_call");
  const distributions = await sumByType("distribution");

  // NAV: latest investor-specific nav entry preferred, else the
  // latest deal-level (no-investor) nav entry, else the deal
  // summary's nav_total maintained by WS-A's refreshDealSummary.
  let nav: number | null = null;
  if (investorPersonId) {
    const rows = await db`
      SELECT amount FROM capital.report_entries
      WHERE deal_id = ${dealId} AND deleted_at IS NULL
        AND entry_type = 'nav' AND investor_person_id = ${investorPersonId}
      ORDER BY as_of DESC, created_at DESC LIMIT 1`;
    if (rows.length) nav = num((rows[0] as Record<string, unknown>).amount);
  }
  if (nav === null) {
    const rows = await db`
      SELECT amount FROM capital.report_entries
      WHERE deal_id = ${dealId} AND deleted_at IS NULL
        AND entry_type = 'nav' AND investor_person_id IS NULL
      ORDER BY as_of DESC, created_at DESC LIMIT 1`;
    if (rows.length) nav = num((rows[0] as Record<string, unknown>).amount);
  }
  if (nav === null) {
    const rows = await db`
      SELECT nav_total FROM capital.deal_summary
      WHERE deal_id = ${dealId} LIMIT 1`;
    if (rows.length) {
      nav = numOrNull((rows[0] as Record<string, unknown>).nav_total);
    }
  }

  const values: Record<string, string | number | null> = {
    investor_name: investorNameVal,
    deal_name: ctx.dealName,
    company_name: ctx.companyName,
    as_of: asOf,
    committed,
    capital_called: capitalCalled,
    distributions,
    nav,
    monitoring_section: MONITORING_PENDING_MARKER,
  };

  const textValues: Record<string, string> = {
    investor_name: investorNameVal,
    deal_name: ctx.dealName,
    company_name: ctx.companyName,
    as_of: asOf,
    committed: fmtMoney0(committed),
    capital_called: fmtMoney0(capitalCalled),
    distributions: fmtMoney0(distributions),
    nav: nav === null ? "—" : fmtMoney0(nav),
    monitoring_section: MONITORING_PENDING_MARKER,
  };

  // Placeholder substitution via split/join — never a RegExp built
  // from a string (production minifier corrupts string-carried \b).
  // Unknown placeholders are left as-is.
  let text = template.body;
  for (const [key, value] of Object.entries(textValues)) {
    text = text.split(`{{${key}}}`).join(value);
  }
  return { text, values };
}
