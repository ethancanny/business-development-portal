import { sql, newId, str, num, numOrNull, isoOrNull } from "../platform/db";
import { publishEvent, onEvent } from "../platform/events";
import {
  createRecord,
  setTypeTag,
  listDirectory,
  getDirectoryDetail,
  type DirectoryListItem,
  type DirectoryLinkedDeal,
  type LegacyInvestorInfo,
} from "../directory/service";
import { getDealContext } from "../diligence/service";
import {
  ensureCapital,
  INVESTOR_TYPES,
  INVESTOR_STATUSES,
  COMMITMENT_KINDS,
  COMMITMENT_STAGES,
} from "./schema";

export { ensureCapital };

/**
 * Investors & Capital service (Phase 7, WS-A) — investor CRM profiles,
 * per-deal raises, commitments, the capital.deal_summary read model,
 * and global valuation params.
 *
 * Module boundaries (PROJECT_RULES.md):
 * - Investor identity lives in the Directory — people are read/created
 *   ONLY through lib/directory/service.ts. This module stores only the
 *   capital profile extension in capital.investor_profiles, keyed by
 *   the Directory person id. The 22 legacy investors already exist as
 *   core people (pe_inv_<legacy id>); profiles attach to those ids —
 *   a second record is never created for them, and their legacy thesis
 *   fields stay on the Directory record (detail.legacyInvestor).
 * - Deal/company context resolves ONLY through getDealContext
 *   (lib/diligence/service.ts); core.deals is read directly only for
 *   the deals index, following the diligence-service precedent.
 * - capital.* writes stay in the capital schema.
 *
 * Commitment mutations publish `investor_commitment_changed` (NO
 * amount in the payload), refresh capital.deal_summary, and write
 * figure-free core.activity_log rows for both the deal and the
 * investor — client financial figures never appear in events/logs.
 */

export class CapitalError extends Error {
  error: string;
  constructor(code: string) {
    super(code);
    this.name = "CapitalError";
    this.error = code;
  }
}

/* ------------------------------ helpers ------------------------------ */

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
function jsonArr<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? (p as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}
function cleanTimestamp(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(s) ? s : null;
}

const INVESTOR_TYPE_KEYS: readonly string[] = INVESTOR_TYPES.map(
  (t) => t.key
);

function validateProfileFields(input: InvestorProfileInput): void {
  if (
    input.investorType !== undefined &&
    input.investorType !== "" &&
    !INVESTOR_TYPE_KEYS.includes(input.investorType)
  ) {
    throw new CapitalError("invalid_investor_type");
  }
  if (
    input.status !== undefined &&
    !(INVESTOR_STATUSES as readonly string[]).includes(input.status)
  ) {
    throw new CapitalError("invalid_status");
  }
}

function validKind(v: string | undefined, fallback: string): string {
  if (v === undefined) return fallback;
  if (!(COMMITMENT_KINDS as readonly string[]).includes(v))
    throw new CapitalError("invalid_kind");
  return v;
}
function validStage(v: string | undefined, fallback: string): string {
  if (v === undefined) return fallback;
  if (!(COMMITMENT_STAGES as readonly string[]).includes(v))
    throw new CapitalError("invalid_stage");
  return v;
}
function validAmount(
  v: number | null | undefined,
  fallback: number
): number {
  if (v === undefined) return fallback;
  if (v === null || typeof v !== "number" || !isFinite(v) || v < 0)
    throw new CapitalError("invalid_amount");
  return v;
}

/** Figure-free activity row (house pattern, wrapped so it never throws). */
async function logActivity(opts: {
  entityKind: string;
  entityId: string;
  actor: string;
  kind: string;
  message: string;
}): Promise<void> {
  try {
    const db = sql();
    await db`
      INSERT INTO core.activity_log
        (id, entity_kind, entity_id, actor, kind, message, source)
      VALUES (${newId()}, ${opts.entityKind}, ${opts.entityId},
        ${opts.actor}, ${opts.kind}, ${opts.message}, 'manual')`;
  } catch (err) {
    console.error(
      "[capital] activity_log write failed",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/* ------------------------------ row types ---------------------------- */

export interface InvestorProfile {
  id: string | null;
  personId: string;
  exists: boolean;
  investorType: string;
  status: string;
  introSource: string;
  lastTouchAt: string | null;
  thesisSectors: string[];
  dealSizeMin: number | null;
  dealSizeMax: number | null;
  checkSizeMin: number | null;
  checkSizeMax: number | null;
  structurePrefs: string;
  notes: string;
  source: string;
  updatedAt: string | null;
}

export interface RaiseRow {
  id: string;
  dealId: string;
  companyId: string | null;
  targetRaise: number;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommitmentRow {
  id: string;
  raiseId: string;
  dealId: string;
  investorPersonId: string;
  investorName: string;
  investorFirm: string;
  amount: number;
  kind: string;
  stage: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface StageBucket {
  soft: number;
  hard: number;
  count: number;
}

export interface DealSummaryByStage {
  indicated: StageBucket;
  committed: StageBucket;
  funded: StageBucket;
  passed: StageBucket;
}

export interface DealSummaryRow {
  dealId: string;
  targetRaise: number;
  softTotal: number;
  hardTotal: number;
  fundedTotal: number;
  byStage: DealSummaryByStage;
  investorCount: number;
  calledTotal: number;
  distributedTotal: number;
  navTotal: number;
  updatedAt: string;
}

function defaultProfile(personId: string): InvestorProfile {
  return {
    id: null,
    personId,
    exists: false,
    investorType: "",
    status: "exploring",
    introSource: "",
    lastTouchAt: null,
    thesisSectors: [],
    dealSizeMin: null,
    dealSizeMax: null,
    checkSizeMin: null,
    checkSizeMax: null,
    structurePrefs: "",
    notes: "",
    source: "manual",
    updatedAt: null,
  };
}

function rowToProfile(r: Record<string, unknown>): InvestorProfile {
  return {
    id: str(r.id),
    personId: str(r.person_id),
    exists: true,
    investorType: str(r.investor_type),
    status: str(r.status) || "exploring",
    introSource: str(r.intro_source),
    lastTouchAt: isoOrNull(r.last_touch_at),
    thesisSectors: jsonArr<unknown>(r.thesis_sectors).map((x) => String(x)),
    dealSizeMin: numOrNull(r.deal_size_min),
    dealSizeMax: numOrNull(r.deal_size_max),
    checkSizeMin: numOrNull(r.check_size_min),
    checkSizeMax: numOrNull(r.check_size_max),
    structurePrefs: str(r.structure_prefs),
    notes: str(r.notes),
    source: str(r.source) || "manual",
    updatedAt: isoOrNull(r.updated_at),
  };
}

function rowToRaise(r: Record<string, unknown>): RaiseRow {
  return {
    id: str(r.id),
    dealId: str(r.deal_id),
    companyId: r.company_id ? str(r.company_id) : null,
    targetRaise: num(r.target_raise),
    status: str(r.status) || "open",
    notes: str(r.notes),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToCommitment(
  r: Record<string, unknown>,
  investorName = "",
  investorFirm = ""
): CommitmentRow {
  return {
    id: str(r.id),
    raiseId: str(r.raise_id),
    dealId: str(r.deal_id),
    investorPersonId: str(r.investor_person_id),
    investorName,
    investorFirm,
    amount: num(r.amount),
    kind: str(r.kind) || "soft",
    stage: str(r.stage) || "indicated",
    notes: str(r.notes),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function emptyByStage(): DealSummaryByStage {
  const bucket = (): StageBucket => ({ soft: 0, hard: 0, count: 0 });
  return {
    indicated: bucket(),
    committed: bucket(),
    funded: bucket(),
    passed: bucket(),
  };
}

function normalizeByStage(v: unknown): DealSummaryByStage {
  const raw = jsonObj(v);
  const bucket = (k: string): StageBucket => {
    const b = jsonObj(raw[k]);
    return { soft: num(b.soft), hard: num(b.hard), count: num(b.count) };
  };
  return {
    indicated: bucket("indicated"),
    committed: bucket("committed"),
    funded: bucket("funded"),
    passed: bucket("passed"),
  };
}

function rowToSummary(r: Record<string, unknown>): DealSummaryRow {
  return {
    dealId: str(r.deal_id),
    targetRaise: num(r.target_raise),
    softTotal: num(r.soft_total),
    hardTotal: num(r.hard_total),
    fundedTotal: num(r.funded_total),
    byStage: normalizeByStage(r.by_stage),
    investorCount: num(r.investor_count),
    calledTotal: num(r.called_total),
    distributedTotal: num(r.distributed_total),
    navTotal: num(r.nav_total),
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

/* --------------------------- investor profiles ----------------------- */

export async function getInvestorProfile(
  personId: string
): Promise<InvestorProfile> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT * FROM capital.investor_profiles
    WHERE person_id = ${personId} AND deleted_at IS NULL LIMIT 1`;
  return rows.length
    ? rowToProfile(rows[0] as Record<string, unknown>)
    : defaultProfile(personId);
}

export interface InvestorProfileInput {
  investorType?: string;
  status?: string;
  introSource?: string;
  lastTouchAt?: string | null;
  thesisSectors?: string[];
  dealSizeMin?: number | null;
  dealSizeMax?: number | null;
  checkSizeMin?: number | null;
  checkSizeMax?: number | null;
  structurePrefs?: string;
  notes?: string;
  source?: string;
}

/**
 * Upsert the capital profile for a person on the live unique index.
 * Partial: only provided fields change. When lastTouchAt is not
 * provided it is left as stored (including on status changes).
 */
async function upsertProfile(
  personId: string,
  input: InvestorProfileInput,
  actor: string
): Promise<InvestorProfile> {
  await ensureCapital();
  validateProfileFields(input);
  const db = sql();
  const rows = await db`
    SELECT * FROM capital.investor_profiles
    WHERE person_id = ${personId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) {
    const id = `capinv_${newId()}`;
    await db`
      INSERT INTO capital.investor_profiles
        (id, person_id, investor_type, status, intro_source,
         last_touch_at, thesis_sectors, deal_size_min, deal_size_max,
         check_size_min, check_size_max, structure_prefs, notes, source,
         created_by)
      VALUES (${id}, ${personId},
        ${input.investorType ?? ""},
        ${input.status ?? "exploring"},
        ${input.introSource ?? ""},
        ${input.lastTouchAt !== undefined ? cleanTimestamp(input.lastTouchAt) : null},
        ${JSON.stringify(input.thesisSectors ?? [])}::jsonb,
        ${input.dealSizeMin ?? null}, ${input.dealSizeMax ?? null},
        ${input.checkSizeMin ?? null}, ${input.checkSizeMax ?? null},
        ${input.structurePrefs ?? ""}, ${input.notes ?? ""},
        ${input.source ?? "manual"}, ${actor})`;
    return getInvestorProfile(personId);
  }
  const cur = rowToProfile(rows[0] as Record<string, unknown>);
  await db`
    UPDATE capital.investor_profiles
    SET investor_type = ${input.investorType !== undefined ? input.investorType : cur.investorType},
        status = ${input.status !== undefined ? input.status : cur.status},
        intro_source = ${input.introSource !== undefined ? input.introSource : cur.introSource},
        last_touch_at = ${input.lastTouchAt !== undefined ? cleanTimestamp(input.lastTouchAt) : cur.lastTouchAt},
        thesis_sectors = ${JSON.stringify(input.thesisSectors !== undefined ? input.thesisSectors : cur.thesisSectors)}::jsonb,
        deal_size_min = ${input.dealSizeMin !== undefined ? input.dealSizeMin : cur.dealSizeMin},
        deal_size_max = ${input.dealSizeMax !== undefined ? input.dealSizeMax : cur.dealSizeMax},
        check_size_min = ${input.checkSizeMin !== undefined ? input.checkSizeMin : cur.checkSizeMin},
        check_size_max = ${input.checkSizeMax !== undefined ? input.checkSizeMax : cur.checkSizeMax},
        structure_prefs = ${input.structurePrefs !== undefined ? input.structurePrefs : cur.structurePrefs},
        notes = ${input.notes !== undefined ? input.notes : cur.notes},
        source = ${input.source !== undefined ? input.source : cur.source},
        updated_at = now()
    WHERE id = ${cur.id}`;
  return getInvestorProfile(personId);
}

/** PUT path: the person must exist in the Directory first. */
export async function updateInvestorProfile(
  personId: string,
  input: InvestorProfileInput,
  actor: string
): Promise<InvestorProfile> {
  const detail = await getDirectoryDetail("person", personId);
  if (!detail) throw new CapitalError("person_not_found");
  return upsertProfile(personId, input, actor);
}

/* ----------------------------- investor list ------------------------- */

/** List row in the Phase 7 API contract shape (personId/firm) —
 * mapped from the Directory list item, never the raw core shape. */
export interface InvestorListItem {
  personId: string;
  name: string;
  firm: string;
  title: string;
  email: string;
  phone: string;
  types: string[];
  profile: InvestorProfile;
}

async function listAllTaggedPeople(type: string): Promise<DirectoryListItem[]> {
  const out: DirectoryListItem[] = [];
  let offset = 0;
  for (;;) {
    const { items, total } = await listDirectory({
      kind: "person",
      type,
      limit: 50,
      offset,
    });
    out.push(...items);
    offset += items.length;
    if (!items.length || offset >= total) break;
  }
  return out;
}

export async function listInvestors(filters: {
  q?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: InvestorListItem[]; total: number }> {
  await ensureCapital();
  const [investors, lps] = await Promise.all([
    listAllTaggedPeople("investor"),
    listAllTaggedPeople("lp"),
  ]);
  const byId = new Map<string, DirectoryListItem>();
  for (const item of [...investors, ...lps]) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  const people = Array.from(byId.values());

  const db = sql();
  const profileRows = await db`
    SELECT * FROM capital.investor_profiles WHERE deleted_at IS NULL`;
  const profiles = new Map<string, InvestorProfile>();
  for (const r of profileRows) {
    const p = rowToProfile(r as Record<string, unknown>);
    profiles.set(p.personId, p);
  }

  let merged: InvestorListItem[] = people.map((person) => ({
    personId: person.id,
    name: person.name,
    firm: person.organizationName,
    title: person.title,
    email: person.email,
    phone: person.phone,
    types: person.types,
    profile: profiles.get(person.id) ?? defaultProfile(person.id),
  }));

  const q = (filters.q ?? "").trim().toLowerCase();
  if (q) {
    merged = merged.filter((item) =>
      [item.name, item.firm, item.email, item.title]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }
  const status = (filters.status ?? "").trim();
  if (status) {
    merged = merged.filter((item) => item.profile.status === status);
  }

  const total = merged.length;
  const limit = Math.min(50, Math.max(1, filters.limit || 25));
  const offset = Math.max(0, filters.offset || 0);
  return { items: merged.slice(offset, offset + limit), total };
}

/* ---------------------------- investor detail ------------------------ */

export interface InvestorCommitmentRow extends CommitmentRow {
  dealName: string;
  companyName: string;
}

export interface InvestorReportTotals {
  capitalCall: number;
  distribution: number;
  nav: number;
}

export interface InvestorActivityRow {
  id: string;
  entityKind: string;
  entityId: string;
  actor: string;
  kind: string;
  message: string;
  source: string;
  createdAt: string | null;
}

export interface InvestorDetailResult {
  record: Record<string, unknown>;
  types: string[];
  linkedDeals: DirectoryLinkedDeal[];
  legacyInvestor: LegacyInvestorInfo | null;
  profile: InvestorProfile;
  commitments: InvestorCommitmentRow[];
  reportTotals: InvestorReportTotals;
  activity: InvestorActivityRow[];
}

export async function getInvestorDetail(
  personId: string
): Promise<InvestorDetailResult> {
  await ensureCapital();
  const detail = await getDirectoryDetail("person", personId);
  if (!detail) throw new CapitalError("person_not_found");
  const profile = await getInvestorProfile(personId);
  const investorName = str(detail.record.name);
  const investorFirm =
    str(detail.record.organizationName) || detail.legacyInvestor?.firm || "";
  const db = sql();

  const commitRows = await db`
    SELECT c.* FROM capital.commitments c
    JOIN capital.raises r ON r.id = c.raise_id AND r.deleted_at IS NULL
    WHERE c.investor_person_id = ${personId} AND c.deleted_at IS NULL
    ORDER BY c.created_at DESC`;
  const commitments: InvestorCommitmentRow[] = [];
  const ctxCache = new Map<
    string,
    { dealName: string; companyName: string }
  >();
  for (const r of commitRows) {
    const rec = r as Record<string, unknown>;
    const base = rowToCommitment(rec, investorName, investorFirm);
    let names = ctxCache.get(base.dealId);
    if (!names) {
      const ctx = await getDealContext(base.dealId).catch(() => null);
      names = {
        dealName: ctx?.dealName ?? "",
        companyName: ctx?.companyName ?? "",
      };
      ctxCache.set(base.dealId, names);
    }
    commitments.push({ ...base, ...names });
  }

  const totalRows = await db`
    SELECT entry_type, coalesce(sum(amount), 0) AS total
    FROM capital.report_entries
    WHERE investor_person_id = ${personId} AND deleted_at IS NULL
    GROUP BY entry_type`;
  const reportTotals: InvestorReportTotals = {
    capitalCall: 0,
    distribution: 0,
    nav: 0,
  };
  for (const r of totalRows) {
    const rec = r as Record<string, unknown>;
    const t = str(rec.entry_type);
    if (t === "capital_call") reportTotals.capitalCall = num(rec.total);
    else if (t === "distribution") reportTotals.distribution = num(rec.total);
    else if (t === "nav") reportTotals.nav = num(rec.total);
  }

  const activityRows = await db`
    SELECT id, entity_kind, entity_id, actor, kind, message, source, created_at
    FROM core.activity_log
    WHERE entity_kind = 'investor' AND entity_id = ${personId}
    ORDER BY created_at DESC
    LIMIT 50`;
  const activity: InvestorActivityRow[] = activityRows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      id: str(rec.id),
      entityKind: str(rec.entity_kind),
      entityId: str(rec.entity_id),
      actor: str(rec.actor),
      kind: str(rec.kind),
      message: str(rec.message),
      source: str(rec.source),
      createdAt: isoOrNull(rec.created_at),
    };
  });

  return {
    record: detail.record,
    types: detail.types,
    linkedDeals: detail.linkedDeals,
    legacyInvestor: detail.legacyInvestor,
    profile,
    commitments,
    reportTotals,
    activity,
  };
}

/* ---------------------------- investor create ------------------------ */

export interface CreateInvestorInput extends InvestorProfileInput {
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  organizationName?: string;
}

/**
 * Create a NEW investor: Directory person (via the directory service)
 * tagged 'investor', then the capital profile from the same body.
 * Legacy investors already exist as Directory people — callers attach
 * profiles to those ids via updateInvestorProfile instead.
 */
export async function createInvestor(
  input: CreateInvestorInput,
  actor: string
): Promise<{ personId: string; profile: InvestorProfile }> {
  const name = (input.name ?? "").trim();
  if (!name) throw new CapitalError("name_required");
  validateProfileFields(input);
  const record = await createRecord({
    kind: "person",
    name,
    title: input.title,
    email: input.email,
    phone: input.phone,
    organizationName: input.organizationName,
    types: ["investor"],
    actor,
    source: "manual",
  });
  const personId = str(record.id);
  if (!personId) throw new CapitalError("person_create_failed");
  await setTypeTag({
    entityKind: "person",
    entityId: personId,
    type: "investor",
    action: "add",
    actor,
  });
  const profile = await upsertProfile(personId, input, actor);
  return { personId, profile };
}

/* ----------------------------- deal summary -------------------------- */

/**
 * Recompute capital.deal_summary for one deal from capital tables
 * ONLY: commitments joined to live raises, report_entries for
 * called/distributed, and nav_total as the sum of the LATEST nav
 * entry per (deal, investor) — latest by as_of, then created_at;
 * deal-level nav entries (investor null) count under their own key.
 * Target raise follows the live open raise (0 when none).
 * Exported for WS-B's reporting service.
 */
export async function refreshDealSummary(
  dealId: string
): Promise<DealSummaryRow> {
  await ensureCapital();
  const db = sql();

  const raiseRows = await db`
    SELECT target_raise FROM capital.raises
    WHERE deal_id = ${dealId} AND status = 'open' AND deleted_at IS NULL
    LIMIT 1`;
  const targetRaise = raiseRows.length
    ? num((raiseRows[0] as Record<string, unknown>).target_raise)
    : 0;

  const commitRows = await db`
    SELECT c.kind, c.stage, c.amount, c.investor_person_id
    FROM capital.commitments c
    JOIN capital.raises r ON r.id = c.raise_id AND r.deleted_at IS NULL
    WHERE c.deal_id = ${dealId} AND c.deleted_at IS NULL`;
  const byStage = emptyByStage();
  let softTotal = 0;
  let hardTotal = 0;
  let fundedTotal = 0;
  const investors = new Set<string>();
  for (const r of commitRows) {
    const rec = r as Record<string, unknown>;
    const kind = str(rec.kind) || "soft";
    const stage = str(rec.stage) || "indicated";
    const amount = num(rec.amount);
    const bucket =
      stage === "committed"
        ? byStage.committed
        : stage === "funded"
          ? byStage.funded
          : stage === "passed"
            ? byStage.passed
            : byStage.indicated;
    bucket.count += 1;
    if (kind === "hard") bucket.hard += amount;
    else bucket.soft += amount;
    if (stage === "passed") continue;
    if (kind === "hard") hardTotal += amount;
    else softTotal += amount;
    if (stage === "funded") fundedTotal += amount;
    const pid = str(rec.investor_person_id);
    if (pid) investors.add(pid);
  }

  const entryRows = await db`
    SELECT entry_type, coalesce(sum(amount), 0) AS total
    FROM capital.report_entries
    WHERE deal_id = ${dealId} AND deleted_at IS NULL
      AND entry_type IN ('capital_call', 'distribution')
    GROUP BY entry_type`;
  let calledTotal = 0;
  let distributedTotal = 0;
  for (const r of entryRows) {
    const rec = r as Record<string, unknown>;
    if (str(rec.entry_type) === "capital_call") calledTotal = num(rec.total);
    else if (str(rec.entry_type) === "distribution")
      distributedTotal = num(rec.total);
  }

  const navRows = await db`
    SELECT DISTINCT ON (coalesce(investor_person_id, '')) amount
    FROM capital.report_entries
    WHERE deal_id = ${dealId} AND entry_type = 'nav'
      AND deleted_at IS NULL
    ORDER BY coalesce(investor_person_id, ''), as_of DESC, created_at DESC`;
  let navTotal = 0;
  for (const r of navRows) {
    navTotal += num((r as Record<string, unknown>).amount);
  }

  await db`
    INSERT INTO capital.deal_summary
      (deal_id, target_raise, soft_total, hard_total, funded_total,
       by_stage, investor_count, called_total, distributed_total,
       nav_total, updated_at)
    VALUES (${dealId}, ${targetRaise}, ${softTotal}, ${hardTotal},
      ${fundedTotal}, ${JSON.stringify(byStage)}::jsonb,
      ${investors.size}, ${calledTotal}, ${distributedTotal}, ${navTotal},
      now())
    ON CONFLICT (deal_id) DO UPDATE SET
      target_raise = EXCLUDED.target_raise,
      soft_total = EXCLUDED.soft_total,
      hard_total = EXCLUDED.hard_total,
      funded_total = EXCLUDED.funded_total,
      by_stage = EXCLUDED.by_stage,
      investor_count = EXCLUDED.investor_count,
      called_total = EXCLUDED.called_total,
      distributed_total = EXCLUDED.distributed_total,
      nav_total = EXCLUDED.nav_total,
      updated_at = now()`;
  return (await getDealSummary(dealId)) as DealSummaryRow;
}

/** Read the stored summary; refresh (creating it) when missing. */
export async function getDealSummary(
  dealId: string
): Promise<DealSummaryRow | null> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT * FROM capital.deal_summary WHERE deal_id = ${dealId} LIMIT 1`;
  if (rows.length) return rowToSummary(rows[0] as Record<string, unknown>);
  return refreshDealSummary(dealId);
}

/* -------------------------------- raises ----------------------------- */

export async function getOpenRaise(
  dealId: string
): Promise<RaiseRow | null> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT * FROM capital.raises
    WHERE deal_id = ${dealId} AND status = 'open' AND deleted_at IS NULL
    LIMIT 1`;
  return rows.length ? rowToRaise(rows[0] as Record<string, unknown>) : null;
}

export async function createRaise(
  dealId: string,
  input: { targetRaise?: number; notes?: string },
  actor: string
): Promise<RaiseRow> {
  await ensureCapital();
  const ctx = await getDealContext(dealId);
  if (!ctx) throw new CapitalError("deal_not_found");
  const existing = await getOpenRaise(dealId);
  if (existing) throw new CapitalError("raise_exists");
  const db = sql();
  const id = `capr_${newId()}`;
  await db`
    INSERT INTO capital.raises
      (id, deal_id, company_id, target_raise, status, notes, created_by)
    VALUES (${id}, ${dealId}, ${ctx.companyId},
      ${input.targetRaise ?? 0}, 'open', ${input.notes ?? ""}, ${actor})`;
  await refreshDealSummary(dealId);
  return (await getOpenRaise(dealId)) as RaiseRow;
}

export async function updateRaise(
  dealId: string,
  patch: { targetRaise?: number; status?: string; notes?: string },
  actor: string
): Promise<RaiseRow> {
  void actor;
  const cur = await getOpenRaise(dealId);
  if (!cur) throw new CapitalError("raise_not_found");
  const db = sql();
  await db`
    UPDATE capital.raises
    SET target_raise = ${patch.targetRaise !== undefined ? patch.targetRaise : cur.targetRaise},
        status = ${patch.status !== undefined && patch.status.trim() ? patch.status.trim() : cur.status},
        notes = ${patch.notes !== undefined ? patch.notes : cur.notes},
        updated_at = now()
    WHERE id = ${cur.id}`;
  await refreshDealSummary(dealId);
  const rows = await db`
    SELECT * FROM capital.raises WHERE id = ${cur.id} LIMIT 1`;
  return rowToRaise(rows[0] as Record<string, unknown>);
}

export async function deleteRaise(
  dealId: string,
  actor: string
): Promise<boolean> {
  void actor;
  const cur = await getOpenRaise(dealId);
  if (!cur) throw new CapitalError("raise_not_found");
  const db = sql();
  await db`
    UPDATE capital.raises SET deleted_at = now(), updated_at = now()
    WHERE id = ${cur.id} AND deleted_at IS NULL`;
  await refreshDealSummary(dealId);
  return true;
}

/* ----------------------------- commitments --------------------------- */

async function investorLabel(
  personId: string,
  cache: Map<string, { name: string; firm: string }>
): Promise<{ name: string; firm: string }> {
  const hit = cache.get(personId);
  if (hit) return hit;
  const detail = await getDirectoryDetail("person", personId).catch(
    () => null
  );
  const label = detail
    ? {
        name: str(detail.record.name),
        firm:
          str(detail.record.organizationName) ||
          detail.legacyInvestor?.firm ||
          "",
      }
    : { name: "", firm: "" };
  cache.set(personId, label);
  return label;
}

async function enrichCommitments(
  rows: Record<string, unknown>[]
): Promise<CommitmentRow[]> {
  const cache = new Map<string, { name: string; firm: string }>();
  const out: CommitmentRow[] = [];
  for (const rec of rows) {
    const label = await investorLabel(str(rec.investor_person_id), cache);
    out.push(rowToCommitment(rec, label.name, label.firm));
  }
  return out;
}

/** Live commitments for a deal (joined to live raises), oldest first. */
export async function listCommitments(
  dealId: string
): Promise<CommitmentRow[]> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT c.* FROM capital.commitments c
    JOIN capital.raises r ON r.id = c.raise_id AND r.deleted_at IS NULL
    WHERE c.deal_id = ${dealId} AND c.deleted_at IS NULL
    ORDER BY c.created_at ASC`;
  return enrichCommitments(rows as Record<string, unknown>[]);
}

export async function getCommitment(
  id: string
): Promise<CommitmentRow | null> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT * FROM capital.commitments
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) return null;
  const [row] = await enrichCommitments(rows as Record<string, unknown>[]);
  return row ?? null;
}

export interface RaiseBundle {
  raise: RaiseRow | null;
  summary: DealSummaryRow | null;
  commitments: CommitmentRow[];
}

export async function getRaiseBundle(
  dealId: string
): Promise<RaiseBundle> {
  const [raise, summary, commitments] = await Promise.all([
    getOpenRaise(dealId),
    getDealSummary(dealId),
    listCommitments(dealId),
  ]);
  return { raise, summary, commitments };
}

/**
 * Side effects for EVERY commitment create/update/delete:
 * (a) publish investor_commitment_changed — NO amount in the payload;
 * (b) refresh the deal summary; (c) figure-free activity rows for the
 * deal AND the investor.
 */
async function afterCommitmentMutation(opts: {
  dealId: string;
  commitmentId: string;
  raiseId: string;
  investorPersonId: string;
  kind: string;
  stage: string;
  change: "created" | "updated" | "deleted";
  actor: string;
}): Promise<void> {
  await publishEvent("investor_commitment_changed", {
    entityKind: "deal",
    entityId: opts.dealId,
    payload: {
      commitmentId: opts.commitmentId,
      raiseId: opts.raiseId,
      investorPersonId: opts.investorPersonId,
      kind: opts.kind,
      stage: opts.stage,
      change: opts.change,
    },
    actor: opts.actor,
  });
  await refreshDealSummary(opts.dealId);
  const ctx = await getDealContext(opts.dealId).catch(() => null);
  const dealName = ctx?.dealName || ctx?.companyName || opts.dealId;
  const message = `Commitment ${opts.change} on ${dealName}`;
  await logActivity({
    entityKind: "deal",
    entityId: opts.dealId,
    actor: opts.actor,
    kind: "investor_commitment_changed",
    message,
  });
  await logActivity({
    entityKind: "investor",
    entityId: opts.investorPersonId,
    actor: opts.actor,
    kind: "investor_commitment_changed",
    message,
  });
}

export interface CommitmentInput {
  investorPersonId?: string;
  amount?: number | null;
  kind?: string;
  stage?: string;
  notes?: string;
}

export async function createCommitment(
  dealId: string,
  input: CommitmentInput,
  actor: string
): Promise<CommitmentRow> {
  await ensureCapital();
  const raise = await getOpenRaise(dealId);
  if (!raise) throw new CapitalError("raise_not_found");
  const kind = validKind(input.kind, "soft");
  const stage = validStage(input.stage, "indicated");
  const amount = validAmount(input.amount, 0);
  const investorPersonId = (input.investorPersonId ?? "").trim();
  const detail = investorPersonId
    ? await getDirectoryDetail("person", investorPersonId)
    : null;
  if (!detail) throw new CapitalError("investor_not_found");
  const db = sql();
  const id = `capc_${newId()}`;
  await db`
    INSERT INTO capital.commitments
      (id, raise_id, deal_id, investor_person_id, amount, kind, stage,
       notes, created_by)
    VALUES (${id}, ${raise.id}, ${dealId}, ${investorPersonId}, ${amount},
      ${kind}, ${stage}, ${input.notes ?? ""}, ${actor})`;
  const created = (await getCommitment(id)) as CommitmentRow;
  await afterCommitmentMutation({
    dealId,
    commitmentId: id,
    raiseId: raise.id,
    investorPersonId,
    kind,
    stage,
    change: "created",
    actor,
  });
  return created;
}

export async function updateCommitment(
  id: string,
  patch: CommitmentInput,
  actor: string
): Promise<CommitmentRow> {
  await ensureCapital();
  const cur = await getCommitment(id);
  if (!cur) throw new CapitalError("commitment_not_found");
  const kind = validKind(patch.kind, cur.kind);
  const stage = validStage(patch.stage, cur.stage);
  const amount = validAmount(patch.amount, cur.amount);
  let investorPersonId = cur.investorPersonId;
  if (
    patch.investorPersonId !== undefined &&
    patch.investorPersonId !== cur.investorPersonId
  ) {
    const detail = await getDirectoryDetail(
      "person",
      patch.investorPersonId
    );
    if (!detail) throw new CapitalError("investor_not_found");
    investorPersonId = patch.investorPersonId;
  }
  const db = sql();
  await db`
    UPDATE capital.commitments
    SET investor_person_id = ${investorPersonId},
        amount = ${amount},
        kind = ${kind},
        stage = ${stage},
        notes = ${patch.notes !== undefined ? patch.notes : cur.notes},
        updated_at = now()
    WHERE id = ${id}`;
  const updated = (await getCommitment(id)) as CommitmentRow;
  await afterCommitmentMutation({
    dealId: cur.dealId,
    commitmentId: id,
    raiseId: cur.raiseId,
    investorPersonId,
    kind,
    stage,
    change: "updated",
    actor,
  });
  return updated;
}

export async function deleteCommitment(
  id: string,
  actor: string
): Promise<boolean> {
  await ensureCapital();
  const cur = await getCommitment(id);
  if (!cur) throw new CapitalError("commitment_not_found");
  const db = sql();
  await db`
    UPDATE capital.commitments SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL`;
  await afterCommitmentMutation({
    dealId: cur.dealId,
    commitmentId: id,
    raiseId: cur.raiseId,
    investorPersonId: cur.investorPersonId,
    kind: cur.kind,
    stage: cur.stage,
    change: "deleted",
    actor,
  });
  return true;
}

/* ------------------------------ deals index -------------------------- */

export interface CapitalDealRow {
  dealId: string;
  companyId: string | null;
  dealName: string;
  companyName: string;
  stage: string;
  summary: DealSummaryRow | null;
}

/**
 * All core.deals with names/stage/company (the same joins as
 * getDealContext) plus each deal's stored capital.deal_summary row
 * or null. Summaries are read, never recomputed here.
 */
export async function listCapitalDeals(): Promise<CapitalDealRow[]> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT cd.id, cd.company_id, cd.stage,
      coalesce(ld.company_name, co.name, '') AS deal_name,
      coalesce(co.name, '') AS company_name,
      s.deal_id AS s_deal_id, s.target_raise AS s_target_raise,
      s.soft_total AS s_soft_total, s.hard_total AS s_hard_total,
      s.funded_total AS s_funded_total, s.by_stage AS s_by_stage,
      s.investor_count AS s_investor_count,
      s.called_total AS s_called_total,
      s.distributed_total AS s_distributed_total,
      s.nav_total AS s_nav_total, s.updated_at AS s_updated_at
    FROM core.deals cd
    LEFT JOIN deals ld ON ld.id = cd.id
    LEFT JOIN core.companies co ON co.id = cd.company_id
    LEFT JOIN capital.deal_summary s ON s.deal_id = cd.id
    ORDER BY cd.updated_at DESC`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    const summary =
      rec.s_deal_id != null
        ? rowToSummary({
            deal_id: rec.s_deal_id,
            target_raise: rec.s_target_raise,
            soft_total: rec.s_soft_total,
            hard_total: rec.s_hard_total,
            funded_total: rec.s_funded_total,
            by_stage: rec.s_by_stage,
            investor_count: rec.s_investor_count,
            called_total: rec.s_called_total,
            distributed_total: rec.s_distributed_total,
            nav_total: rec.s_nav_total,
            updated_at: rec.s_updated_at,
          })
        : null;
    return {
      dealId: str(rec.id),
      companyId: rec.company_id ? str(rec.company_id) : null,
      dealName: str(rec.deal_name),
      companyName: str(rec.company_name),
      stage: str(rec.stage),
      summary,
    };
  });
}

/* --------------------------- valuation params ------------------------ */

export const VALUATION_NUMERIC_KEYS = [
  "entryMultipleLow",
  "entryMultipleHigh",
  "targetIrr",
  "leverageLow",
  "leverageHigh",
  "entryMultiple",
  "leverageMultiple",
  "exitMultiple",
  "growthPct",
  "holdYears",
  "advisoryFeePct",
  "financingFeePct",
  "mgmtFeePct",
  "prefPct",
  "carryPct",
  "debtPaydownPct",
] as const;

export type ValuationNumericKey = (typeof VALUATION_NUMERIC_KEYS)[number];

export type ValuationParams = Record<ValuationNumericKey, number> & {
  updatedBy: string;
  updatedAt: string | null;
};

function rowToValuationParams(
  r: Record<string, unknown>
): ValuationParams {
  return {
    entryMultipleLow: num(r.entry_multiple_low),
    entryMultipleHigh: num(r.entry_multiple_high),
    targetIrr: num(r.target_irr),
    leverageLow: num(r.leverage_low),
    leverageHigh: num(r.leverage_high),
    entryMultiple: num(r.entry_multiple),
    leverageMultiple: num(r.leverage_multiple),
    exitMultiple: num(r.exit_multiple),
    growthPct: num(r.growth_pct),
    holdYears: num(r.hold_years),
    advisoryFeePct: num(r.advisory_fee_pct),
    financingFeePct: num(r.financing_fee_pct),
    mgmtFeePct: num(r.mgmt_fee_pct),
    prefPct: num(r.pref_pct),
    carryPct: num(r.carry_pct),
    debtPaydownPct: num(r.debt_paydown_pct),
    updatedBy: str(r.updated_by),
    updatedAt: isoOrNull(r.updated_at),
  };
}

export async function getValuationParams(): Promise<ValuationParams> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT * FROM capital.valuation_params WHERE id = 'global' LIMIT 1`;
  if (!rows.length) throw new CapitalError("params_not_found");
  return rowToValuationParams(rows[0] as Record<string, unknown>);
}

export async function updateValuationParams(
  patch: Partial<Record<ValuationNumericKey, number>>,
  actor: string
): Promise<ValuationParams> {
  const cur = await getValuationParams();
  const merged = {} as Record<ValuationNumericKey, number>;
  for (const key of VALUATION_NUMERIC_KEYS) {
    merged[key] = patch[key] !== undefined ? patch[key] : cur[key];
  }
  for (const key of VALUATION_NUMERIC_KEYS) {
    const v = merged[key];
    if (typeof v !== "number" || !isFinite(v) || v < 0)
      throw new CapitalError("invalid_params");
  }
  if (
    merged.entryMultipleLow > merged.entryMultipleHigh ||
    merged.leverageLow > merged.leverageHigh
  ) {
    throw new CapitalError("invalid_params");
  }
  const db = sql();
  await db`
    UPDATE capital.valuation_params
    SET entry_multiple_low = ${merged.entryMultipleLow},
        entry_multiple_high = ${merged.entryMultipleHigh},
        target_irr = ${merged.targetIrr},
        leverage_low = ${merged.leverageLow},
        leverage_high = ${merged.leverageHigh},
        entry_multiple = ${merged.entryMultiple},
        leverage_multiple = ${merged.leverageMultiple},
        exit_multiple = ${merged.exitMultiple},
        growth_pct = ${merged.growthPct},
        hold_years = ${merged.holdYears},
        advisory_fee_pct = ${merged.advisoryFeePct},
        financing_fee_pct = ${merged.financingFeePct},
        mgmt_fee_pct = ${merged.mgmtFeePct},
        pref_pct = ${merged.prefPct},
        carry_pct = ${merged.carryPct},
        debt_paydown_pct = ${merged.debtPaydownPct},
        updated_by = ${actor},
        updated_at = now()
    WHERE id = 'global'`;
  return getValuationParams();
}

/* ------------------------- event registration ------------------------ */
/**
 * Belt-and-braces: commitment mutations refresh the deal summary
 * directly, and this handler refreshes it again for any
 * investor_commitment_changed event (entity = the deal) that arrives
 * from another path. Registered once per process.
 */
let capitalHandlerRegistered = false;
function registerCapitalHandlers(): void {
  if (capitalHandlerRegistered) return;
  capitalHandlerRegistered = true;
  onEvent("investor_commitment_changed", async (evt) => {
    if (evt.entityKind && evt.entityKind !== "deal") return;
    const dealId = evt.entityId;
    if (!dealId) return;
    try {
      await refreshDealSummary(dealId);
    } catch (err) {
      console.error(
        "[capital] onEvent summary refresh failed for deal",
        dealId,
        err instanceof Error ? err.message : String(err)
      );
    }
  });
}
registerCapitalHandlers();
