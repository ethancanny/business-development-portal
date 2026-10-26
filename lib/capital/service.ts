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
import { getBdConfig, getDealMetricsForDeals } from "../bd/service";
import { bumpDatasets } from "../platform/versions";
import { INVESTMENT_TYPE_LABELS, type InvestmentTypeKey } from "../types";
import {
  ensureCapital,
  INVESTOR_TYPES,
  INVESTOR_STATUSES,
  COMMITMENT_KINDS,
  COMMITMENT_STAGES,
  PIPELINE_STAGES,
  DOC_STATUSES,
} from "./schema";
import {
  scoreInvestorForRaise,
  DEFAULT_MATCHING_WEIGHTS,
  type MatchingWeights,
  type MatchReason,
} from "./matching";

export {
  DEFAULT_MATCHING_WEIGHTS,
  type MatchingWeights,
  type MatchReason,
};

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

/** DATE column → 'YYYY-MM-DD' (or null). */
function dateOnly(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s ? s.slice(0, 10) : null;
}
function cleanDateOnly(v: unknown): string | null {
  const t = cleanTimestamp(v);
  return t ? t.slice(0, 10) : null;
}

export interface CheckRange {
  min: number | null;
  max: number | null;
}

function parseCheckByType(v: unknown): Record<string, CheckRange> {
  const raw = jsonObj(v);
  const out: Record<string, CheckRange> = {};
  for (const [k, val] of Object.entries(raw)) {
    const r = jsonObj(val);
    out[k] = {
      min: typeof r.min === "number" ? r.min : null,
      max: typeof r.max === "number" ? r.max : null,
    };
  }
  return out;
}

function parseStageDates(v: unknown): Record<string, string> {
  const raw = jsonObj(v);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(raw)) {
    if (typeof val === "string" && val) out[k] = val;
  }
  return out;
}

const INVESTOR_TYPE_KEYS: readonly string[] = INVESTOR_TYPES.map(
  (t) => t.key
);

const PIPELINE_STAGE_KEYS: readonly string[] = PIPELINE_STAGES.map(
  (t) => t.key
);
const DOC_STATUS_KEYS: readonly string[] = DOC_STATUSES as readonly string[];

function validPipelineStage(
  v: string | undefined,
  fallback: string
): string {
  if (v === undefined) return fallback;
  if (!PIPELINE_STAGE_KEYS.includes(v))
    throw new CapitalError("invalid_pipeline_stage");
  return v;
}
function validDocStatus(v: string | undefined, fallback: string): string {
  if (v === undefined) return fallback;
  if (!DOC_STATUS_KEYS.includes(v))
    throw new CapitalError("invalid_doc_status");
  return v;
}
function validOptAmount(
  v: number | null | undefined,
  fallback: number | null
): number | null {
  if (v === undefined) return fallback;
  if (v === null) return null;
  if (typeof v !== "number" || !isFinite(v) || v < 0)
    throw new CapitalError("invalid_amount");
  return v;
}

/** Legacy stage → Kanban pipeline stage (used when a commitment is
 * created/updated through the legacy fields only). */
function legacyToPipeline(stage: string): string {
  switch (stage) {
    case "funded":
      return "funded";
    case "passed":
      return "passed";
    case "committed":
      return "committed";
    default:
      return "interested";
  }
}

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
  /** Redesign Step 1: Directory capital-profile tab fields. */
  geography: string;
  accreditedStatus: string;
  relationshipOwner: string;
  /** Investment type keys this investor invests in (bd type keys). */
  investsInTypes: string[];
  /** Per-type check ranges, keyed by investment type key. */
  checkByType: Record<string, CheckRange>;
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
  /** Redesign Step 1: SPV/entity name + next milestone. */
  entityName: string;
  nextMilestone: string;
  nextMilestoneDate: string | null;
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
  /** Redesign Step 1: participation-link fields. The four bucket
   * amounts are null until set explicitly — bucketAmounts() derives
   * them from the legacy (amount, kind, stage) triple until then. */
  pipelineStage: string;
  indicatedAmount: number | null;
  softAmount: number | null;
  hardAmount: number | null;
  fundedAmount: number | null;
  owner: string;
  docStatus: string;
  wireStatus: string;
  expectedFundingDate: string | null;
  stageDates: Record<string, string>;
}

/**
 * Bucket semantics (Redesign Step 1): a commitment's money sits in
 * exactly one set of buckets. When ANY of the explicit bucket amounts
 * (indicated/soft/hard/funded_amount) is non-null, the explicit
 * amounts rule (null counts as 0). Otherwise the buckets derive from
 * the legacy triple: stage 'funded' → funded = amount; kind 'hard'
 * at stage 'committed' → hard = amount; kind 'hard' at stage
 * 'indicated' → indicated = amount; kind 'soft' at any non-funded
 * stage → soft = amount; stage 'passed' → all zero.
 */
export interface BucketAmounts {
  indicated: number;
  soft: number;
  hard: number;
  funded: number;
}

export function bucketAmounts(r: {
  amount?: unknown;
  kind?: unknown;
  stage?: unknown;
  indicated_amount?: unknown;
  soft_amount?: unknown;
  hard_amount?: unknown;
  funded_amount?: unknown;
  indicatedAmount?: unknown;
  softAmount?: unknown;
  hardAmount?: unknown;
  fundedAmount?: unknown;
}): BucketAmounts {
  const pick = (snake: unknown, camel: unknown): number | null => {
    const v = snake !== undefined ? snake : camel;
    return v === null || v === undefined ? null : num(v);
  };
  const indicated = pick(r.indicated_amount, r.indicatedAmount);
  const soft = pick(r.soft_amount, r.softAmount);
  const hard = pick(r.hard_amount, r.hardAmount);
  const funded = pick(r.funded_amount, r.fundedAmount);
  if (
    indicated !== null ||
    soft !== null ||
    hard !== null ||
    funded !== null
  ) {
    return {
      indicated: indicated ?? 0,
      soft: soft ?? 0,
      hard: hard ?? 0,
      funded: funded ?? 0,
    };
  }
  const amount = num(r.amount);
  const kind = str(r.kind) || "soft";
  const stage = str(r.stage) || "indicated";
  if (stage === "passed") return { indicated: 0, soft: 0, hard: 0, funded: 0 };
  if (stage === "funded") return { indicated: 0, soft: 0, hard: 0, funded: amount };
  if (kind === "hard" && stage === "committed")
    return { indicated: 0, soft: 0, hard: amount, funded: 0 };
  if (kind === "hard")
    return { indicated: amount, soft: 0, hard: 0, funded: 0 };
  return { indicated: 0, soft: amount, hard: 0, funded: 0 };
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
  /** Redesign Step 1: Σ indicated bucket across live commitments. */
  indicatedTotal: number;
  byStage: DealSummaryByStage;
  /** Redesign Step 1: commitment counts per Kanban pipeline stage,
   * stored inside by_stage JSON under the 'pipeline' key. */
  pipelineByStage: Record<string, number>;
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
    geography: "",
    accreditedStatus: "",
    relationshipOwner: "",
    investsInTypes: [],
    checkByType: {},
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
    geography: str(r.geography),
    accreditedStatus: str(r.accredited_status),
    relationshipOwner: str(r.relationship_owner),
    investsInTypes: jsonArr<unknown>(r.invests_in_types).map((x) => String(x)),
    checkByType: parseCheckByType(r.check_by_type),
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
    entityName: str(r.entity_name),
    nextMilestone: str(r.next_milestone),
    nextMilestoneDate: dateOnly(r.next_milestone_date),
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
    pipelineStage: str(r.pipeline_stage),
    indicatedAmount: numOrNull(r.indicated_amount),
    softAmount: numOrNull(r.soft_amount),
    hardAmount: numOrNull(r.hard_amount),
    fundedAmount: numOrNull(r.funded_amount),
    owner: str(r.owner),
    docStatus: str(r.doc_status) || "none",
    wireStatus: str(r.wire_status) || "pending",
    expectedFundingDate: dateOnly(r.expected_funding_date),
    stageDates: parseStageDates(r.stage_dates),
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

function normalizePipelineCounts(v: unknown): Record<string, number> {
  const raw = jsonObj(jsonObj(v).pipeline);
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(raw)) out[k] = num(val);
  return out;
}

function rowToSummary(r: Record<string, unknown>): DealSummaryRow {
  return {
    dealId: str(r.deal_id),
    targetRaise: num(r.target_raise),
    softTotal: num(r.soft_total),
    hardTotal: num(r.hard_total),
    fundedTotal: num(r.funded_total),
    indicatedTotal: num(r.indicated_total),
    byStage: normalizeByStage(r.by_stage),
    pipelineByStage: normalizePipelineCounts(r.by_stage),
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
  geography?: string;
  accreditedStatus?: string;
  relationshipOwner?: string;
  investsInTypes?: string[];
  checkByType?: Record<string, CheckRange>;
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
         created_by, geography, accredited_status, relationship_owner,
         invests_in_types, check_by_type)
      VALUES (${id}, ${personId},
        ${input.investorType ?? ""},
        ${input.status ?? "exploring"},
        ${input.introSource ?? ""},
        ${input.lastTouchAt !== undefined ? cleanTimestamp(input.lastTouchAt) : null},
        ${JSON.stringify(input.thesisSectors ?? [])}::jsonb,
        ${input.dealSizeMin ?? null}, ${input.dealSizeMax ?? null},
        ${input.checkSizeMin ?? null}, ${input.checkSizeMax ?? null},
        ${input.structurePrefs ?? ""}, ${input.notes ?? ""},
        ${input.source ?? "manual"}, ${actor},
        ${input.geography ?? ""}, ${input.accreditedStatus ?? ""},
        ${input.relationshipOwner ?? ""},
        ${JSON.stringify(input.investsInTypes ?? [])}::jsonb,
        ${JSON.stringify(input.checkByType ?? {})}::jsonb)`;
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
        geography = ${input.geography !== undefined ? input.geography : cur.geography},
        accredited_status = ${input.accreditedStatus !== undefined ? input.accreditedStatus : cur.accreditedStatus},
        relationship_owner = ${input.relationshipOwner !== undefined ? input.relationshipOwner : cur.relationshipOwner},
        invests_in_types = ${JSON.stringify(input.investsInTypes !== undefined ? input.investsInTypes : cur.investsInTypes)}::jsonb,
        check_by_type = ${JSON.stringify(input.checkByType !== undefined ? input.checkByType : cur.checkByType)}::jsonb,
        updated_at = now()
    WHERE id = ${cur.id}`;
  return getInvestorProfile(personId);
}

/**
 * Resolve a Directory record that may be a person OR an organization
 * (investor profiles attach to either kind — e.g. a family office
 * stored as an organization). Returns the detail or null.
 */
async function resolveInvestorRecord(personId: string) {
  const person = await getDirectoryDetail("person", personId).catch(
    () => null
  );
  if (person) return person;
  return getDirectoryDetail("organization", personId).catch(() => null);
}

/** PUT path: the record must exist in the Directory first (person
 * or organization). */
export async function updateInvestorProfile(
  personId: string,
  input: InvestorProfileInput,
  actor: string
): Promise<InvestorProfile> {
  const detail = await resolveInvestorRecord(personId);
  if (!detail) throw new CapitalError("person_not_found");
  return upsertProfile(personId, input, actor);
}

/** POST touch: stamp last_touch_at = now on the investor's profile. */
export async function touchInvestorProfile(
  personId: string,
  actor: string
): Promise<InvestorProfile> {
  return updateInvestorProfile(
    personId,
    { lastTouchAt: new Date().toISOString() },
    actor
  );
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
  const detail = await resolveInvestorRecord(personId);
  if (!detail) throw new CapitalError("person_not_found");
  const profile = await getInvestorProfile(personId);
  const investorName = str(detail.record.name);
  const isOrg = str(detail.record.entityKind) === "organization";
  const investorFirm = isOrg
    ? ""
    : str(detail.record.organizationName) || detail.legacyInvestor?.firm || "";
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
    SELECT c.kind, c.stage, c.amount, c.investor_person_id,
      c.pipeline_stage, c.indicated_amount, c.soft_amount,
      c.hard_amount, c.funded_amount
    FROM capital.commitments c
    JOIN capital.raises r ON r.id = c.raise_id AND r.deleted_at IS NULL
    WHERE c.deal_id = ${dealId} AND c.deleted_at IS NULL`;
  const byStage = emptyByStage();
  // Redesign Step 1: Kanban pipeline-stage counts ride inside the
  // by_stage JSON under 'pipeline' (existing keys keep their shape).
  const pipelineCounts: Record<string, number> = {};
  let softTotal = 0;
  let hardTotal = 0;
  let fundedTotal = 0;
  let indicatedTotal = 0;
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
    const pipelineStage =
      str(rec.pipeline_stage) || legacyToPipeline(stage);
    pipelineCounts[pipelineStage] = (pipelineCounts[pipelineStage] ?? 0) + 1;
    if (stage === "passed") continue;
    // Money totals come from the bucket semantics: explicit bucket
    // amounts when present, the legacy derivation otherwise.
    const buckets = bucketAmounts(rec);
    const hasExplicit =
      rec.indicated_amount != null ||
      rec.soft_amount != null ||
      rec.hard_amount != null ||
      rec.funded_amount != null;
    indicatedTotal += buckets.indicated;
    fundedTotal += buckets.funded;
    if (hasExplicit) {
      softTotal += buckets.soft;
      hardTotal += buckets.hard;
    } else if (stage === "funded") {
      // Legacy rows: the funded amount is also the commitment total,
      // counted under its kind exactly as before the redesign.
      if (kind === "hard") hardTotal += amount;
      else softTotal += amount;
    } else {
      softTotal += buckets.soft;
      hardTotal += buckets.hard;
    }
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
       nav_total, updated_at, indicated_total)
    VALUES (${dealId}, ${targetRaise}, ${softTotal}, ${hardTotal},
      ${fundedTotal},
      ${JSON.stringify({ ...byStage, pipeline: pipelineCounts })}::jsonb,
      ${investors.size}, ${calledTotal}, ${distributedTotal}, ${navTotal},
      now(), ${indicatedTotal})
    ON CONFLICT (deal_id) DO UPDATE SET
      target_raise = EXCLUDED.target_raise,
      soft_total = EXCLUDED.soft_total,
      hard_total = EXCLUDED.hard_total,
      funded_total = EXCLUDED.funded_total,
      indicated_total = EXCLUDED.indicated_total,
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

export interface RaiseInput {
  targetRaise?: number;
  notes?: string;
  entityName?: string;
  nextMilestone?: string;
  nextMilestoneDate?: string | null;
}

export async function createRaise(
  dealId: string,
  input: RaiseInput,
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
      (id, deal_id, company_id, target_raise, status, notes, created_by,
       entity_name, next_milestone, next_milestone_date)
    VALUES (${id}, ${dealId}, ${ctx.companyId},
      ${input.targetRaise ?? 0}, 'open', ${input.notes ?? ""}, ${actor},
      ${input.entityName ?? ""}, ${input.nextMilestone ?? ""},
      ${input.nextMilestoneDate !== undefined ? cleanDateOnly(input.nextMilestoneDate) : null})`;
  await refreshDealSummary(dealId);
  await bumpDatasets("capital");
  return (await getOpenRaise(dealId)) as RaiseRow;
}

export async function updateRaise(
  dealId: string,
  patch: RaiseInput & { status?: string },
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
        entity_name = ${patch.entityName !== undefined ? patch.entityName : cur.entityName},
        next_milestone = ${patch.nextMilestone !== undefined ? patch.nextMilestone : cur.nextMilestone},
        next_milestone_date = ${patch.nextMilestoneDate !== undefined ? cleanDateOnly(patch.nextMilestoneDate) : cur.nextMilestoneDate},
        updated_at = now()
    WHERE id = ${cur.id}`;
  await refreshDealSummary(dealId);
  await bumpDatasets("capital");
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
  await bumpDatasets("capital");
  return true;
}

/* ----------------------------- commitments --------------------------- */

async function investorLabel(
  personId: string,
  cache: Map<string, { name: string; firm: string }>
): Promise<{ name: string; firm: string }> {
  const hit = cache.get(personId);
  if (hit) return hit;
  const detail = await resolveInvestorRecord(personId);
  const label = detail
    ? {
        name: str(detail.record.name),
        firm:
          str(detail.record.entityKind) === "organization"
            ? ""
            : str(detail.record.organizationName) ||
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
  // Direct bump as well as the event-map bump (investor_commitment_changed
  // → capital): harmless duplication, and it guarantees coverage for
  // every commitment create/update/delete through this choke point.
  await bumpDatasets("capital");
}

export interface CommitmentInput {
  investorPersonId?: string;
  amount?: number | null;
  kind?: string;
  stage?: string;
  notes?: string;
  /** Redesign Step 1 participation-link fields. */
  pipelineStage?: string;
  indicatedAmount?: number | null;
  softAmount?: number | null;
  hardAmount?: number | null;
  fundedAmount?: number | null;
  owner?: string;
  docStatus?: string;
  wireStatus?: string;
  expectedFundingDate?: string | null;
}

interface SyncedLegacy {
  stage: string;
  kind: string;
  total: number;
}

/**
 * Keep the legacy (stage, kind, amount) triple consistent with the
 * pipeline stage + bucket amounts so pre-redesign readers (summary
 * rollups, reporting) stay correct: funded bucket or a Funded
 * pipeline stage → stage 'funded'; a Committed pipeline stage or any
 * hard money → stage 'committed' with kind 'hard' when hard money
 * exists; Passed → 'passed'; anything else → 'indicated'.
 */
function syncLegacy(
  pipelineStage: string,
  buckets: BucketAmounts,
  fallbackKind: string
): SyncedLegacy {
  const total =
    buckets.indicated + buckets.soft + buckets.hard + buckets.funded;
  if (pipelineStage === "passed")
    return { stage: "passed", kind: fallbackKind, total };
  if (pipelineStage === "funded" || buckets.funded > 0)
    return {
      stage: "funded",
      kind: buckets.hard > 0 || buckets.funded > 0 ? "hard" : fallbackKind,
      total,
    };
  if (pipelineStage === "committed" || buckets.hard > 0)
    return {
      stage: "committed",
      kind: buckets.hard > 0 ? "hard" : fallbackKind,
      total,
    };
  return {
    stage: "indicated",
    kind: buckets.soft > 0 ? "soft" : fallbackKind,
    total,
  };
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function createCommitment(
  dealId: string,
  input: CommitmentInput,
  actor: string
): Promise<CommitmentRow> {
  await ensureCapital();
  const raise = await getOpenRaise(dealId);
  if (!raise) throw new CapitalError("raise_not_found");
  let kind = validKind(input.kind, "soft");
  let stage = validStage(input.stage, "indicated");
  let amount = validAmount(input.amount, 0);
  const pipelineStage = validPipelineStage(
    input.pipelineStage,
    legacyToPipeline(stage)
  );
  const buckets: BucketAmounts = {
    indicated: validOptAmount(input.indicatedAmount, null) ?? 0,
    soft: validOptAmount(input.softAmount, null) ?? 0,
    hard: validOptAmount(input.hardAmount, null) ?? 0,
    funded: validOptAmount(input.fundedAmount, null) ?? 0,
  };
  const hasBuckets =
    input.indicatedAmount !== undefined ||
    input.softAmount !== undefined ||
    input.hardAmount !== undefined ||
    input.fundedAmount !== undefined;
  if (input.pipelineStage !== undefined || hasBuckets) {
    const synced = syncLegacy(pipelineStage, buckets, kind);
    stage = synced.stage;
    kind = synced.kind;
    if (hasBuckets) amount = synced.total;
  }
  const docStatus = validDocStatus(input.docStatus, "none");
  const investorPersonId = (input.investorPersonId ?? "").trim();
  const detail = investorPersonId
    ? await resolveInvestorRecord(investorPersonId)
    : null;
  if (!detail) throw new CapitalError("investor_not_found");
  const db = sql();
  const id = `capc_${newId()}`;
  const stageDates: Record<string, string> = {
    [pipelineStage]: todayDateOnly(),
  };
  await db`
    INSERT INTO capital.commitments
      (id, raise_id, deal_id, investor_person_id, amount, kind, stage,
       notes, created_by, pipeline_stage, indicated_amount, soft_amount,
       hard_amount, funded_amount, owner, doc_status, wire_status,
       expected_funding_date, stage_dates)
    VALUES (${id}, ${raise.id}, ${dealId}, ${investorPersonId}, ${amount},
      ${kind}, ${stage}, ${input.notes ?? ""}, ${actor},
      ${pipelineStage},
      ${hasBuckets ? buckets.indicated : null},
      ${hasBuckets ? buckets.soft : null},
      ${hasBuckets ? buckets.hard : null},
      ${hasBuckets ? buckets.funded : null},
      ${input.owner ?? ""}, ${docStatus},
      ${input.wireStatus !== undefined && input.wireStatus.trim() ? input.wireStatus.trim() : "pending"},
      ${input.expectedFundingDate !== undefined ? cleanDateOnly(input.expectedFundingDate) : null},
      ${JSON.stringify(stageDates)}::jsonb)`;
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
  let kind = validKind(patch.kind, cur.kind);
  let stage = validStage(patch.stage, cur.stage);
  let amount = validAmount(patch.amount, cur.amount);
  const pipelineStage = validPipelineStage(
    patch.pipelineStage,
    cur.pipelineStage || legacyToPipeline(cur.stage)
  );
  const indicatedAmount = validOptAmount(patch.indicatedAmount, cur.indicatedAmount);
  const softAmount = validOptAmount(patch.softAmount, cur.softAmount);
  const hardAmount = validOptAmount(patch.hardAmount, cur.hardAmount);
  const fundedAmount = validOptAmount(patch.fundedAmount, cur.fundedAmount);
  const bucketsTouched =
    patch.pipelineStage !== undefined ||
    patch.indicatedAmount !== undefined ||
    patch.softAmount !== undefined ||
    patch.hardAmount !== undefined ||
    patch.fundedAmount !== undefined;
  if (bucketsTouched) {
    const synced = syncLegacy(
      pipelineStage,
      {
        indicated: indicatedAmount ?? 0,
        soft: softAmount ?? 0,
        hard: hardAmount ?? 0,
        funded: fundedAmount ?? 0,
      },
      kind
    );
    stage = synced.stage;
    kind = synced.kind;
    const anyExplicit =
      indicatedAmount !== null ||
      softAmount !== null ||
      hardAmount !== null ||
      fundedAmount !== null;
    if (anyExplicit) amount = synced.total;
  }
  const docStatus = validDocStatus(patch.docStatus, cur.docStatus);
  // Stamp the stage-entry date when the pipeline stage changes.
  const stageDates =
    pipelineStage !== cur.pipelineStage
      ? { ...cur.stageDates, [pipelineStage]: todayDateOnly() }
      : cur.stageDates;
  let investorPersonId = cur.investorPersonId;
  if (
    patch.investorPersonId !== undefined &&
    patch.investorPersonId !== cur.investorPersonId
  ) {
    const detail = await resolveInvestorRecord(patch.investorPersonId);
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
        pipeline_stage = ${pipelineStage},
        indicated_amount = ${indicatedAmount},
        soft_amount = ${softAmount},
        hard_amount = ${hardAmount},
        funded_amount = ${fundedAmount},
        owner = ${patch.owner !== undefined ? patch.owner : cur.owner},
        doc_status = ${docStatus},
        wire_status = ${patch.wireStatus !== undefined && patch.wireStatus.trim() ? patch.wireStatus.trim() : cur.wireStatus},
        expected_funding_date = ${patch.expectedFundingDate !== undefined ? cleanDateOnly(patch.expectedFundingDate) : cur.expectedFundingDate},
        stage_dates = ${JSON.stringify(stageDates)}::jsonb,
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

export interface CapitalDealType {
  key: string;
  label: string;
  enabled: boolean;
}

export interface CapitalDealRow {
  dealId: string;
  companyId: string | null;
  dealName: string;
  companyName: string;
  stage: string;
  summary: DealSummaryRow | null;
  /** Redesign Step 1 extensions. */
  raise: RaiseRow | null;
  investmentType: CapitalDealType | null;
  /** deals.is_test_data (added Oct 25, 2026) — test deals hide from
   * default views behind the "Show test data" toggle. */
  isTestData: boolean;
  /** Open-raise milestone + entity, lifted to the top level for
   * raise cards and the Timeline view (also on `raise`). */
  nextMilestoneLabel: string | null;
  nextMilestoneDate: string | null;
  entityName: string | null;
  parentDeal: { id: string; name: string } | null;
  /** Whitelisted bd deal metrics for the deal's type (value = the
   * metric's num or text, keyed by metric key). */
  metrics: Record<string, number | string | null>;
  leadInvestorName: string | null;
  investorAvatars: Array<{ personId: string; name: string }>;
}

/** bd metric keys surfaced on capital raise cards, per type. */
const CARD_METRIC_KEYS: Record<string, string[]> = {
  platform_lbo: ["equity_check", "leverage_x"],
  add_on: ["funding_source", "purchase_multiple", "synergies_annual"],
  early_stage: [
    "round_size",
    "instrument",
    "pre_money",
    "valuation_cap",
    "check_size",
    "lead_investor",
    "round_stage",
  ],
  minority_growth: [
    "mg_check_size",
    "mg_instrument",
    "mg_pre_money",
    "mg_ownership_pct",
  ],
};

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
      coalesce(ld.investment_type, '') AS inv_type,
      coalesce(ld.is_test_data, false) AS is_test,
      ld.parent_deal_id AS parent_id,
      coalesce(pd.company_name, '') AS parent_name,
      s.deal_id AS s_deal_id, s.target_raise AS s_target_raise,
      s.soft_total AS s_soft_total, s.hard_total AS s_hard_total,
      s.funded_total AS s_funded_total, s.by_stage AS s_by_stage,
      s.investor_count AS s_investor_count,
      s.called_total AS s_called_total,
      s.distributed_total AS s_distributed_total,
      s.nav_total AS s_nav_total, s.updated_at AS s_updated_at,
      s.indicated_total AS s_indicated_total
    FROM core.deals cd
    LEFT JOIN deals ld ON ld.id = cd.id
    LEFT JOIN deals pd ON pd.id = ld.parent_deal_id
    LEFT JOIN core.companies co ON co.id = cd.company_id
    LEFT JOIN capital.deal_summary s ON s.deal_id = cd.id
    ORDER BY cd.updated_at DESC`;

  // Redesign Step 1 enrichment — all through service boundaries:
  // type config + deal metrics via lib/bd/service, investor names
  // via the Directory (investorLabel). Failures degrade to empty
  // enrichment, never fail the index.
  let typeByKey = new Map<string, CapitalDealType>();
  let metricsByDeal: Awaited<ReturnType<typeof getDealMetricsForDeals>> = {};
  try {
    const cfg = await getBdConfig();
    typeByKey = new Map(
      cfg.types.map((t) => [
        t.key,
        { key: t.key, label: t.label, enabled: t.enabled },
      ])
    );
    metricsByDeal = await getDealMetricsForDeals(
      rows.map((r) => str((r as Record<string, unknown>).id))
    );
  } catch {
    /* bd unavailable — type falls back to the static labels below */
  }

  const raiseRows = await db`
    SELECT * FROM capital.raises
    WHERE status = 'open' AND deleted_at IS NULL`;
  const raiseByDeal = new Map<string, RaiseRow>();
  for (const r of raiseRows) {
    const raise = rowToRaise(r as Record<string, unknown>);
    if (!raiseByDeal.has(raise.dealId)) raiseByDeal.set(raise.dealId, raise);
  }

  const commitRows = await db`
    SELECT c.deal_id, c.investor_person_id, c.kind, c.stage, c.amount,
      c.indicated_amount, c.soft_amount, c.hard_amount, c.funded_amount
    FROM capital.commitments c
    JOIN capital.raises r ON r.id = c.raise_id AND r.deleted_at IS NULL
    WHERE c.deleted_at IS NULL`;
  const exposureByDeal = new Map<string, Map<string, number>>();
  for (const r of commitRows) {
    const rec = r as Record<string, unknown>;
    const dealId = str(rec.deal_id);
    const pid = str(rec.investor_person_id);
    if (!dealId || !pid) continue;
    const b = bucketAmounts(rec);
    let perDeal = exposureByDeal.get(dealId);
    if (!perDeal) {
      perDeal = new Map();
      exposureByDeal.set(dealId, perDeal);
    }
    perDeal.set(pid, (perDeal.get(pid) ?? 0) + b.hard + b.funded);
  }
  const labelCache = new Map<string, { name: string; firm: string }>();

  const out: CapitalDealRow[] = [];
  for (const r of rows) {
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
            indicated_total: rec.s_indicated_total,
          })
        : null;
    const dealId = str(rec.id);
    const typeKey = str(rec.inv_type);
    const investmentType: CapitalDealType | null = typeKey
      ? (typeByKey.get(typeKey) ?? {
          key: typeKey,
          label:
            INVESTMENT_TYPE_LABELS[typeKey as InvestmentTypeKey] ?? typeKey,
          enabled: typeKey !== "minority_growth",
        })
      : null;
    const metrics: Record<string, number | string | null> = {};
    const dealMetrics = metricsByDeal[dealId] ?? {};
    for (const key of CARD_METRIC_KEYS[typeKey] ?? []) {
      const v = dealMetrics[key];
      if (v) metrics[key] = v.num ?? v.text ?? null;
    }
    const exposure = exposureByDeal.get(dealId);
    const ranked = exposure
      ? Array.from(exposure.entries()).sort((a, b) => b[1] - a[1])
      : [];
    const investorAvatars: Array<{ personId: string; name: string }> = [];
    for (const [pid] of ranked.slice(0, 8)) {
      const label = await investorLabel(pid, labelCache);
      investorAvatars.push({ personId: pid, name: label.name });
    }
    let leadInvestorName: string | null = null;
    if (ranked.length && ranked[0][1] > 0) {
      const label = await investorLabel(ranked[0][0], labelCache);
      leadInvestorName = label.name || null;
    }
    const openRaise = raiseByDeal.get(dealId) ?? null;
    out.push({
      dealId,
      companyId: rec.company_id ? str(rec.company_id) : null,
      dealName: str(rec.deal_name),
      companyName: str(rec.company_name),
      stage: str(rec.stage),
      summary,
      raise: openRaise,
      investmentType,
      isTestData: rec.is_test === true,
      nextMilestoneLabel: openRaise?.nextMilestone || null,
      nextMilestoneDate: openRaise?.nextMilestoneDate ?? null,
      entityName: openRaise?.entityName || null,
      parentDeal: rec.parent_id
        ? { id: str(rec.parent_id), name: str(rec.parent_name) }
        : null,
      metrics,
      leadInvestorName,
      investorAvatars,
    });
  }
  return out;
}

/* ------------------------- matching weights -------------------------- */

function weightsFromJson(v: unknown): MatchingWeights {
  const raw = jsonObj(v);
  const pick = (k: keyof MatchingWeights): number => {
    const n = raw[k];
    return typeof n === "number" && isFinite(n) && n >= 0
      ? n
      : DEFAULT_MATCHING_WEIGHTS[k];
  };
  return {
    type: pick("type"),
    checkSize: pick("checkSize"),
    sector: pick("sector"),
    structure: pick("structure"),
    geography: pick("geography"),
    activity: pick("activity"),
  };
}

export async function getMatchingWeights(): Promise<MatchingWeights> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT weights FROM capital.matching_weights WHERE id = 'global' LIMIT 1`;
  if (!rows.length) return { ...DEFAULT_MATCHING_WEIGHTS };
  return weightsFromJson((rows[0] as Record<string, unknown>).weights);
}

export async function updateMatchingWeights(
  patch: Partial<MatchingWeights>,
  actor: string
): Promise<MatchingWeights> {
  const cur = await getMatchingWeights();
  const merged: MatchingWeights = { ...cur };
  (Object.keys(DEFAULT_MATCHING_WEIGHTS) as Array<keyof MatchingWeights>).forEach(
    (k) => {
      const v = patch[k];
      if (v !== undefined) {
        if (typeof v !== "number" || !isFinite(v) || v < 0)
          throw new CapitalError("invalid_weights");
        merged[k] = v;
      }
    }
  );
  const db = sql();
  await db`
    INSERT INTO capital.matching_weights (id, weights, updated_by)
    VALUES ('global', ${JSON.stringify(merged)}::jsonb, ${actor})
    ON CONFLICT (id) DO UPDATE SET
      weights = EXCLUDED.weights,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()`;
  return getMatchingWeights();
}

/* --------------------------- page summary ---------------------------- */

export interface CapitalTypeOption {
  key: string;
  label: string;
  enabled: boolean;
}

export interface CapitalClosingItem {
  dealId: string;
  dealName: string;
  label: string;
  date: string;
}

export interface CapitalTypeTotals {
  typeKey: string;
  label: string;
  enabled: boolean;
  raiseCount: number;
  target: number;
  soft: number;
  hard: number;
  funded: number;
}

export interface CapitalPageSummary {
  target: number;
  indicated: number;
  soft: number;
  hard: number;
  funded: number;
  /** target − (soft + hard + funded) across open raises. */
  remaining: number;
  closingsNext30: CapitalClosingItem[];
  byType: CapitalTypeTotals[];
  types: CapitalTypeOption[];
}

interface OpenRaiseJoined {
  raise: RaiseRow;
  dealName: string;
  typeKey: string;
  summary: DealSummaryRow | null;
}

async function listOpenRaisesJoined(): Promise<OpenRaiseJoined[]> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT r.*, coalesce(ld.company_name, '') AS deal_name,
      coalesce(ld.investment_type, 'platform_lbo') AS inv_type,
      s.deal_id AS s_deal_id, s.target_raise AS s_target_raise,
      s.soft_total AS s_soft_total, s.hard_total AS s_hard_total,
      s.funded_total AS s_funded_total, s.by_stage AS s_by_stage,
      s.investor_count AS s_investor_count,
      s.called_total AS s_called_total,
      s.distributed_total AS s_distributed_total,
      s.nav_total AS s_nav_total, s.updated_at AS s_updated_at,
      s.indicated_total AS s_indicated_total
    FROM capital.raises r
    LEFT JOIN deals ld ON ld.id = r.deal_id
    LEFT JOIN capital.deal_summary s ON s.deal_id = r.deal_id
    WHERE r.status = 'open' AND r.deleted_at IS NULL`;
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
            indicated_total: rec.s_indicated_total,
          })
        : null;
    return {
      raise: rowToRaise(rec),
      dealName: str(rec.deal_name),
      typeKey: str(rec.inv_type) || "platform_lbo",
      summary,
    };
  });
}

async function configuredTypes(): Promise<CapitalTypeOption[]> {
  try {
    const cfg = await getBdConfig();
    return cfg.types.map((t) => ({
      key: t.key,
      label: t.label,
      enabled: t.enabled,
    }));
  } catch {
    return (
      Object.keys(INVESTMENT_TYPE_LABELS) as InvestmentTypeKey[]
    ).map((key) => ({
      key,
      label: INVESTMENT_TYPE_LABELS[key],
      enabled: key !== "minority_growth",
    }));
  }
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Page-level rollup across OPEN raises, read from capital.raises +
 * the stored capital.deal_summary (never recomputed from commitments
 * on load). The one exception, noted per the build contract: a
 * bounded commitments read for expected_funding_date values due in
 * the next 30 days, which are not part of the stored summary.
 * When typeKey is given, the totals + closings filter to that type;
 * byType always covers every configured type.
 */
export async function getCapitalPageSummary(
  typeKey?: string
): Promise<CapitalPageSummary> {
  const [joined, types] = await Promise.all([
    listOpenRaisesJoined(),
    configuredTypes(),
  ]);
  const today = todayDateOnly();
  const in30 = addDaysIso(today, 30);

  const byTypeMap = new Map<string, CapitalTypeTotals>();
  for (const t of types) {
    byTypeMap.set(t.key, {
      typeKey: t.key,
      label: t.label,
      enabled: t.enabled,
      raiseCount: 0,
      target: 0,
      soft: 0,
      hard: 0,
      funded: 0,
    });
  }
  for (const j of joined) {
    const bt = byTypeMap.get(j.typeKey);
    if (!bt) continue;
    bt.raiseCount += 1;
    bt.target += j.summary?.targetRaise ?? j.raise.targetRaise;
    bt.soft += j.summary?.softTotal ?? 0;
    bt.hard += j.summary?.hardTotal ?? 0;
    bt.funded += j.summary?.fundedTotal ?? 0;
  }

  const scoped = typeKey
    ? joined.filter((j) => j.typeKey === typeKey)
    : joined;
  let target = 0;
  let indicated = 0;
  let soft = 0;
  let hard = 0;
  let funded = 0;
  const closings: CapitalClosingItem[] = [];
  const scopedDealIds = new Set<string>();
  for (const j of scoped) {
    scopedDealIds.add(j.raise.dealId);
    target += j.summary?.targetRaise ?? j.raise.targetRaise;
    indicated += j.summary?.indicatedTotal ?? 0;
    soft += j.summary?.softTotal ?? 0;
    hard += j.summary?.hardTotal ?? 0;
    funded += j.summary?.fundedTotal ?? 0;
    const d = j.raise.nextMilestoneDate;
    if (d && d >= today && d <= in30) {
      closings.push({
        dealId: j.raise.dealId,
        dealName: j.dealName,
        label: j.raise.nextMilestone || "Next milestone",
        date: d,
      });
    }
  }

  // Bounded commitments read: expected funding dates due ≤30d.
  const db = sql();
  const dueRows = await db`
    SELECT c.deal_id, c.expected_funding_date,
      coalesce(ld.company_name, '') AS deal_name
    FROM capital.commitments c
    JOIN capital.raises r ON r.id = c.raise_id AND r.deleted_at IS NULL
    LEFT JOIN deals ld ON ld.id = c.deal_id
    WHERE c.deleted_at IS NULL AND c.expected_funding_date IS NOT NULL
      AND c.expected_funding_date >= CURRENT_DATE
      AND c.expected_funding_date <= CURRENT_DATE + 30`;
  for (const r of dueRows) {
    const rec = r as Record<string, unknown>;
    const dealId = str(rec.deal_id);
    if (!scopedDealIds.has(dealId)) continue;
    const d = dateOnly(rec.expected_funding_date);
    if (!d) continue;
    closings.push({
      dealId,
      dealName: str(rec.deal_name),
      label: "Investor funding due",
      date: d,
    });
  }
  closings.sort((a, b) => a.date.localeCompare(b.date));

  return {
    target,
    indicated,
    soft,
    hard,
    funded,
    remaining: target - (soft + hard + funded),
    closingsNext30: closings,
    byType: Array.from(byTypeMap.values()),
    types,
  };
}

/* ------------------------------ matching ----------------------------- */

export interface MatchResultItem {
  personId: string;
  name: string;
  firm: string;
  score: number;
  reasons: MatchReason[];
  profileExists: boolean;
  inRaise: boolean;
}

export interface RaiseMatching {
  items: MatchResultItem[];
  weights: MatchingWeights;
  dealId: string;
  typeKey: string | null;
  typeLabel: string;
  target: number;
}

/**
 * Ranked Directory investors for one deal's open raise: every person
 * or organization with a capital profile, PLUS every participant on
 * any raise (prior-commitment signal), scored by lib/capital/matching
 * against the deal's type / industry / target.
 */
export async function listMatchingForRaise(
  dealId: string
): Promise<RaiseMatching> {
  await ensureCapital();
  const ctx = await getDealContext(dealId);
  if (!ctx) throw new CapitalError("deal_not_found");
  const [weights, raise, summary, types] = await Promise.all([
    getMatchingWeights(),
    getOpenRaise(dealId),
    getDealSummary(dealId),
    configuredTypes(),
  ]);
  const target = summary?.targetRaise ?? raise?.targetRaise ?? 0;
  const remaining =
    target -
    ((summary?.softTotal ?? 0) +
      (summary?.hardTotal ?? 0) +
      (summary?.fundedTotal ?? 0));
  const typeKey = ctx.investmentType ? ctx.investmentType : null;
  const typeLabel = typeKey
    ? (types.find((t) => t.key === typeKey)?.label ??
      INVESTMENT_TYPE_LABELS[typeKey as InvestmentTypeKey] ??
      typeKey)
    : "";

  const db = sql();
  const profileRows = await db`
    SELECT * FROM capital.investor_profiles WHERE deleted_at IS NULL`;
  const profiles = new Map<string, InvestorProfile>();
  for (const r of profileRows) {
    const prof = rowToProfile(r as Record<string, unknown>);
    profiles.set(prof.personId, prof);
  }
  const participantRows = await db`
    SELECT DISTINCT investor_person_id FROM capital.commitments
    WHERE deleted_at IS NULL`;
  const priorIds = new Set(
    participantRows.map((r) =>
      str((r as Record<string, unknown>).investor_person_id)
    )
  );
  const dealParticipantRows = await db`
    SELECT DISTINCT investor_person_id FROM capital.commitments
    WHERE deal_id = ${dealId} AND deleted_at IS NULL`;
  const inRaiseIds = new Set(
    dealParticipantRows.map((r) =>
      str((r as Record<string, unknown>).investor_person_id)
    )
  );

  const ids = new Set<string>(
    Array.from(profiles.keys()).concat(Array.from(priorIds))
  );
  const labelCache = new Map<string, { name: string; firm: string }>();
  const items: MatchResultItem[] = [];
  for (const pid of Array.from(ids)) {
    if (!pid) continue;
    const profile = profiles.get(pid) ?? null;
    const label = await investorLabel(pid, labelCache);
    const scored = scoreInvestorForRaise(
      {
        profile: profile
          ? {
              exists: true,
              thesisSectors: profile.thesisSectors,
              structurePrefs: profile.structurePrefs,
              geography: profile.geography,
              checkSizeMin: profile.checkSizeMin,
              checkSizeMax: profile.checkSizeMax,
              investsInTypes: profile.investsInTypes,
              checkByType: profile.checkByType,
            }
          : null,
        dealTypeKey: typeKey,
        dealTypeLabel: typeLabel,
        industry: ctx.industry,
        target,
        remaining,
        hasPriorCommitment: priorIds.has(pid),
        lastTouchAt: profile?.lastTouchAt ?? null,
      },
      weights
    );
    items.push({
      personId: pid,
      name: label.name,
      firm: label.firm,
      score: scored.score,
      reasons: scored.reasons,
      profileExists: Boolean(profile),
      inRaise: inRaiseIds.has(pid),
    });
  }
  items.sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name)
  );
  return { items, weights, dealId, typeKey, typeLabel, target };
}

/* --------------------------- matching matrix ------------------------- */

export interface MatrixRaise {
  raiseId: string;
  dealId: string;
  dealName: string;
  typeKey: string;
  typeLabel: string;
  target: number;
}

export interface MatrixCell {
  pipelineStage: string;
  stage: string;
  hard: number;
  funded: number;
}

export interface MatrixInvestor {
  personId: string;
  name: string;
  firm: string;
  types: string[];
  exposure: number;
  capacity: number | null;
  cells: Record<string, MatrixCell>;
}

export interface MatchingMatrix {
  raises: MatrixRaise[];
  investors: MatrixInvestor[];
  total: number;
  suggestions: Record<
    string,
    Array<{ personId: string; name: string; score: number }>
  >;
}

export async function getMatchingMatrix(opts: {
  typeKey?: string;
  limit?: number;
  offset?: number;
}): Promise<MatchingMatrix> {
  const [joined, types] = await Promise.all([
    listOpenRaisesJoined(),
    configuredTypes(),
  ]);
  const typeLabelOf = (k: string) =>
    types.find((t) => t.key === k)?.label ??
    INVESTMENT_TYPE_LABELS[k as InvestmentTypeKey] ??
    k;
  const scoped = opts.typeKey
    ? joined.filter((j) => j.typeKey === opts.typeKey)
    : joined;
  const raises: MatrixRaise[] = scoped.map((j) => ({
    raiseId: j.raise.id,
    dealId: j.raise.dealId,
    dealName: j.dealName,
    typeKey: j.typeKey,
    typeLabel: typeLabelOf(j.typeKey),
    target: j.summary?.targetRaise ?? j.raise.targetRaise,
  }));
  const raiseIds = new Set(raises.map((r) => r.raiseId));

  const db = sql();
  const commitRows = raiseIds.size
    ? await db`
        SELECT c.* FROM capital.commitments c
        WHERE c.deleted_at IS NULL`
    : [];
  const profileRows = await db`
    SELECT * FROM capital.investor_profiles WHERE deleted_at IS NULL`;
  const profiles = new Map<string, InvestorProfile>();
  for (const r of profileRows) {
    const prof = rowToProfile(r as Record<string, unknown>);
    profiles.set(prof.personId, prof);
  }

  const cellsByInvestor = new Map<string, Record<string, MatrixCell>>();
  const exposureByInvestor = new Map<string, number>();
  for (const r of commitRows) {
    const rec = r as Record<string, unknown>;
    const raiseId = str(rec.raise_id);
    if (!raiseIds.has(raiseId)) continue;
    const pid = str(rec.investor_person_id);
    if (!pid) continue;
    const b = bucketAmounts(rec);
    let cells = cellsByInvestor.get(pid);
    if (!cells) {
      cells = {};
      cellsByInvestor.set(pid, cells);
    }
    const cell = (cells[raiseId] ??= {
      pipelineStage: "",
      stage: "",
      hard: 0,
      funded: 0,
    });
    cell.hard += b.hard;
    cell.funded += b.funded;
    cell.pipelineStage = str(rec.pipeline_stage) || cell.pipelineStage;
    cell.stage = str(rec.stage) || cell.stage;
    exposureByInvestor.set(
      pid,
      (exposureByInvestor.get(pid) ?? 0) + b.hard + b.funded
    );
  }

  const ids = new Set<string>(
    Array.from(profiles.keys()).concat(Array.from(cellsByInvestor.keys()))
  );
  const labelCache = new Map<string, { name: string; firm: string }>();
  const all: MatrixInvestor[] = [];
  for (const pid of Array.from(ids)) {
    if (!pid) continue;
    const label = await investorLabel(pid, labelCache);
    const profile = profiles.get(pid) ?? null;
    all.push({
      personId: pid,
      name: label.name,
      firm: label.firm,
      types: profile?.investsInTypes ?? [],
      exposure: exposureByInvestor.get(pid) ?? 0,
      capacity: profile?.checkSizeMax ?? null,
      cells: cellsByInvestor.get(pid) ?? {},
    });
  }
  all.sort(
    (a, b) => b.exposure - a.exposure || a.name.localeCompare(b.name)
  );
  const total = all.length;
  const limit = Math.min(200, Math.max(1, opts.limit || 50));
  const offset = Math.max(0, opts.offset || 0);
  const investors = all.slice(offset, offset + limit);

  const suggestions: MatchingMatrix["suggestions"] = {};
  for (const raise of raises) {
    try {
      const matching = await listMatchingForRaise(raise.dealId);
      suggestions[raise.dealId] = matching.items
        .slice(0, 3)
        .map((i) => ({
          personId: i.personId,
          name: i.name,
          score: i.score,
        }));
    } catch {
      suggestions[raise.dealId] = [];
    }
  }
  return { raises, investors, total, suggestions };
}

/* ----------------------------- action items -------------------------- */

export interface ActionItem {
  kind:
    | "stale_touch"
    | "unsigned_doc"
    | "unfunded"
    | "closing"
    | "behind_target";
  severity: "info" | "amber" | "red";
  title: string;
  detail: string;
  href: string;
  date: string | null;
}

const SEVERITY_RANK: Record<ActionItem["severity"], number> = {
  red: 0,
  amber: 1,
  info: 2,
};

/**
 * Action Center (Redesign Step 1): one list of what needs action
 * across open raises — stale investor touches, unsigned documents,
 * unfunded commitments, upcoming closings, raises behind target.
 * Rules are applied literally from the spec; every item links to its
 * source (/investors-capital/<dealId> or /directory/<personId>).
 */
export async function getActionItems(
  typeKey?: string
): Promise<{ items: ActionItem[] }> {
  const joinedAll = await listOpenRaisesJoined();
  const joined = typeKey
    ? joinedAll.filter((j) => j.typeKey === typeKey)
    : joinedAll;
  const dealIds = new Set(joined.map((j) => j.raise.dealId));
  const today = todayDateOnly();
  const items: ActionItem[] = [];
  const db = sql();

  const commitRows = await db`
    SELECT c.* FROM capital.commitments c
    JOIN capital.raises r ON r.id = c.raise_id AND r.deleted_at IS NULL
    WHERE c.deleted_at IS NULL`;
  const commits = (commitRows as Record<string, unknown>[]).filter((rec) =>
    dealIds.has(str(rec.deal_id))
  );
  const participantsByInvestor = new Map<string, Set<string>>();
  for (const rec of commits) {
    const pid = str(rec.investor_person_id);
    if (!pid) continue;
    let set = participantsByInvestor.get(pid);
    if (!set) {
      set = new Set();
      participantsByInvestor.set(pid, set);
    }
    set.add(str(rec.deal_id));
  }

  const labelCache = new Map<string, { name: string; firm: string }>();
  const labelOf = async (pid: string): Promise<string> => {
    const label = await investorLabel(pid, labelCache);
    return label.name || pid;
  };

  /* stale touches */
  const profileRows = await db`
    SELECT * FROM capital.investor_profiles WHERE deleted_at IS NULL`;
  const nowMs = Date.now();
  for (const r of profileRows) {
    const profile = rowToProfile(r as Record<string, unknown>);
    const participating = participantsByInvestor.has(profile.personId);
    const activeStatus =
      profile.status === "active" || profile.status === "committed";
    if (!participating && !activeStatus) continue;
    const name = await labelOf(profile.personId);
    if (!profile.lastTouchAt) {
      if (participating) {
        items.push({
          kind: "stale_touch",
          severity: "red",
          title: `Stale touch — ${name}`,
          detail: "Participating in a raise but never touched",
          href: `/directory/${profile.personId}`,
          date: null,
        });
      }
      continue;
    }
    const days = Math.floor(
      (nowMs - new Date(profile.lastTouchAt).getTime()) / 86_400_000
    );
    if (days > 30) {
      items.push({
        kind: "stale_touch",
        severity: "red",
        title: `Stale touch — ${name}`,
        detail: `Last touch ${days} days ago`,
        href: `/directory/${profile.personId}`,
        date: dateOnly(profile.lastTouchAt),
      });
    } else if (days > 14) {
      items.push({
        kind: "stale_touch",
        severity: "amber",
        title: `Stale touch — ${name}`,
        detail: `Last touch ${days} days ago`,
        href: `/directory/${profile.personId}`,
        date: dateOnly(profile.lastTouchAt),
      });
    }
  }

  /* commitment-driven items */
  const in30 = addDaysIso(today, 30);
  for (const rec of commits) {
    const dealId = str(rec.deal_id);
    const pid = str(rec.investor_person_id);
    const name = await labelOf(pid);
    const pipelineStage =
      str(rec.pipeline_stage) || legacyToPipeline(str(rec.stage));
    const stage = str(rec.stage);
    const docStatus = str(rec.doc_status) || "none";
    const buckets = bucketAmounts(rec);
    const expected = dateOnly(rec.expected_funding_date);
    const href = `/investors-capital/${dealId}`;

    if (
      (docStatus === "draft" || docStatus === "sent") &&
      (pipelineStage === "committed" ||
        pipelineStage === "funded" ||
        stage === "committed" ||
        stage === "funded")
    ) {
      const fundedStage = pipelineStage === "funded" || stage === "funded";
      items.push({
        kind: "unsigned_doc",
        severity: fundedStage ? "red" : "amber",
        title: `Document awaiting signature — ${name}`,
        detail: `Document status is '${docStatus}' on a ${fundedStage ? "funded" : "committed"} commitment`,
        href,
        date: null,
      });
    }

    if (
      (pipelineStage === "committed" || stage === "committed") &&
      buckets.funded === 0
    ) {
      const pastDue = expected !== null && expected < today;
      items.push({
        kind: "unfunded",
        severity: pastDue ? "red" : "amber",
        title: `Commitment not yet funded — ${name}`,
        detail: pastDue
          ? `Expected funding date ${expected} has passed with nothing funded`
          : "Committed but nothing funded yet",
        href,
        date: expected,
      });
    }

    if (expected && expected >= today && expected <= in30) {
      items.push({
        kind: "closing",
        severity: expected <= addDaysIso(today, 14) ? "amber" : "info",
        title: `Funding due — ${name}`,
        detail: `Expected funding date ${expected}`,
        href,
        date: expected,
      });
    }
  }

  /* raise-driven items: closings + behind target */
  const in45 = addDaysIso(today, 45);
  for (const j of joined) {
    const href = `/investors-capital/${j.raise.dealId}`;
    const name = j.dealName || j.raise.dealId;
    const milestoneDate = j.raise.nextMilestoneDate;
    if (milestoneDate && milestoneDate >= today && milestoneDate <= in30) {
      items.push({
        kind: "closing",
        severity: milestoneDate <= addDaysIso(today, 14) ? "amber" : "info",
        title: `Upcoming closing — ${name}`,
        detail: `${j.raise.nextMilestone || "Next milestone"} on ${milestoneDate}`,
        href,
        date: milestoneDate,
      });
    }
    const target = j.summary?.targetRaise ?? j.raise.targetRaise;
    const hardPlusFunded =
      (j.summary?.hardTotal ?? 0) + (j.summary?.fundedTotal ?? 0);
    if (target > 0 && hardPlusFunded < target * 0.5) {
      const createdMs = new Date(j.raise.createdAt).getTime();
      const ageDays = Number.isFinite(createdMs)
        ? Math.floor((nowMs - createdMs) / 86_400_000)
        : 0;
      const milestoneSoon =
        milestoneDate !== null && milestoneDate <= in45;
      if (milestoneSoon || ageDays > 60) {
        const pct =
          target > 0 ? Math.round((hardPlusFunded / target) * 100) : 0;
        items.push({
          kind: "behind_target",
          severity: "amber",
          title: `Raise behind target — ${name}`,
          detail: `Hard + funded $${Math.round(hardPlusFunded).toLocaleString("en-US")} of $${Math.round(target).toLocaleString("en-US")} target (${pct}%)`,
          href,
          date: milestoneDate,
        });
      }
    }
  }

  items.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      String(a.date ?? "9999").localeCompare(String(b.date ?? "9999"))
  );
  return { items };
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
