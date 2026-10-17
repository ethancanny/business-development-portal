import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { logActivity } from "./db";

/**
 * Operator candidates (Ethan's Operator Discovery & Sourcing spec,
 * Oct 15, 2026 — Build 1, the data layer). Candidates are a pre-Directory
 * system: a person found by a sourcing sweep or feed lives here as a
 * Candidate until Ethan reviews them (Verified) and they are added to
 * the Directory / Executive Sourcing pipeline. Separate from the
 * `executives` table on purpose — nothing here touches pipeline records.
 *
 * Source-URL rule (Ethan, Oct 16, 2026 — hard requirement): every
 * candidate carries the URL it was found at. The create path rejects a
 * record without one, and the "LinkedIn" source label is allowed only
 * when the URL is a linkedin.com page (profile, company page, or post) —
 * LinkedIn finds arrive via the public search index; there is no
 * connector and no automated login.
 *
 * Dedupe: identity key = normalized name + company + title. Creating a
 * candidate whose key already exists MERGES: a sighting is appended and
 * lastSeen advances; no duplicate row is ever written.
 */

export const CANDIDATE_STATUSES = [
  "Candidate",
  "Verified",
  "Contacted",
  "Interviewing",
  "Paired",
  "Passed",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export interface CandidateSighting {
  sourceType: string;
  sourceUrl: string;
  date: string;
}

/** One scored component of a candidate's fit score (Build 2). The UI
 * shows these beside the total so the score is never a black box. */
export interface CandidateScoreComponent {
  key: string;
  label: string;
  points: number;
  max: number;
  evidence: string[];
}

export interface CandidateScoreFactors {
  total: number;
  components: CandidateScoreComponent[];
}

/** A top-3 pairing between a candidate and a fit target or pipeline
 * deal (Build 2). basis is the human-readable "why" string. */
export interface CandidateMatch {
  type: "company" | "deal";
  id: string;
  name: string;
  sector: string;
  relation: "same" | "adjacent" | "other";
  city: string;
  matchScore: number;
  basis: string;
}

/** Conflict of interest flag (spec: flagged, never excluded). */
export interface CandidateConflict {
  type: "target_employer" | "deal_employer" | "competing_buyer";
  name: string;
  targetId?: string;
  detail: string;
}

export interface OperatorCandidate {
  id: string;
  name: string;
  currentTitle: string;
  company: string;
  industry: string;
  focusSector: boolean;
  city: string;
  locationVerified: boolean;
  sourceType: string;
  sourceUrl: string;
  dateFound: string;
  lastSeen: string;
  referrer: string;
  fitNotes: string;
  status: CandidateStatus;
  passReason: string;
  lastTouch: string;
  nextStep: string;
  targetRole: string;
  sightings: CandidateSighting[];
  /** Build 2 scoring/matching — null score means unscored (location
   * unverified candidates are never scored, per spec). */
  score: number | null;
  scoreFactors: CandidateScoreFactors | null;
  scoredAt: string;
  matchedTargets: CandidateMatch[];
  conflicts: CandidateConflict[];
  createdAt: string;
  updatedAt: string;
}

export interface CandidateAuditEntry {
  id: string;
  candidateId: string;
  candidateName: string;
  actor: string;
  action: string;
  summary: string;
  before: OperatorCandidate | null;
  after: OperatorCandidate | null;
  createdAt: string;
}

export interface CandidateInput {
  name?: string;
  currentTitle?: string;
  company?: string;
  industry?: string;
  focusSector?: boolean;
  city?: string;
  locationVerified?: boolean;
  sourceType?: string;
  sourceUrl?: string;
  dateFound?: string;
  referrer?: string;
  fitNotes?: string;
  status?: string;
  passReason?: string;
  lastTouch?: string;
  nextStep?: string;
  targetRole?: string;
}

type Sql = NeonQueryFunction<false, false>;

let cached: Sql | null = null;
function sql(): Sql {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    cached = neon(url);
  }
  return cached;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v ?? new Date().toISOString());

const today = (): string => new Date().toISOString().slice(0, 10);

let ensured = false;
async function ensure(): Promise<void> {
  if (ensured) return;
  const q = sql();
  await q`CREATE TABLE IF NOT EXISTS operator_candidates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    current_title TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    industry TEXT NOT NULL DEFAULT '',
    focus_sector BOOLEAN NOT NULL DEFAULT FALSE,
    city TEXT NOT NULL DEFAULT '',
    location_verified BOOLEAN NOT NULL DEFAULT TRUE,
    source_type TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    date_found TEXT NOT NULL DEFAULT '',
    last_seen TEXT NOT NULL DEFAULT '',
    referrer TEXT NOT NULL DEFAULT '',
    fit_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Candidate',
    pass_reason TEXT NOT NULL DEFAULT '',
    last_touch TEXT NOT NULL DEFAULT '',
    next_step TEXT NOT NULL DEFAULT '',
    target_role TEXT NOT NULL DEFAULT '',
    dedup_key TEXT NOT NULL DEFAULT '',
    sightings JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await q`CREATE UNIQUE INDEX IF NOT EXISTS operator_candidates_key_idx
    ON operator_candidates (dedup_key)`;
  // Build 2: scoring + matching columns (additive; pre-Build-2 rows
  // simply read as unscored until the first rescore run).
  await q`ALTER TABLE operator_candidates ADD COLUMN IF NOT EXISTS score INTEGER`;
  await q`ALTER TABLE operator_candidates ADD COLUMN IF NOT EXISTS score_factors JSONB`;
  await q`ALTER TABLE operator_candidates ADD COLUMN IF NOT EXISTS scored_at TEXT NOT NULL DEFAULT ''`;
  await q`ALTER TABLE operator_candidates ADD COLUMN IF NOT EXISTS matched_targets JSONB NOT NULL DEFAULT '[]'`;
  await q`ALTER TABLE operator_candidates ADD COLUMN IF NOT EXISTS conflicts JSONB NOT NULL DEFAULT '[]'`;
  await q`CREATE TABLE IF NOT EXISTS operator_match_state (
    id TEXT PRIMARY KEY,
    payload JSONB,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await q`CREATE TABLE IF NOT EXISTS candidate_audit (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL DEFAULT '',
    candidate_name TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    before JSONB,
    after JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await q`CREATE INDEX IF NOT EXISTS candidate_audit_candidate_idx
    ON candidate_audit (candidate_id, created_at DESC)`;
  ensured = true;
}

/* ---------------- identity / dedupe ---------------- */

function normPart(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,'"’|/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Identity key: normalized name + company + title (spec dedupe rule). */
export function candidateKey(
  name: string,
  company: string,
  currentTitle: string
): string {
  return `${normPart(name)}|${normPart(company)}|${normPart(currentTitle)}`;
}

/* ---------------- source-URL rule ---------------- */

/**
 * Returns an error message when the (sourceType, sourceUrl) pair breaks
 * Ethan's source-URL rule, or null when it is acceptable.
 */
export function validateSource(
  sourceType: string,
  sourceUrl: string
): string | null {
  const url = (sourceUrl ?? "").trim();
  if (!url) {
    return "sourceUrl is required — every candidate record must carry the URL it was found at.";
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "sourceUrl must be a valid URL.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "sourceUrl must be an http(s) URL.";
  }
  if ((sourceType ?? "").trim().toLowerCase() === "linkedin") {
    const host = parsed.hostname.toLowerCase();
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) {
      return 'sourceType "LinkedIn" requires a linkedin.com URL (profile, company page, or post). Label the record with the source type that matches the URL instead.';
    }
  }
  return null;
}

export function isCandidateStatus(v: string): v is CandidateStatus {
  return (CANDIDATE_STATUSES as readonly string[]).includes(v);
}

/* ---------------- row mapping ---------------- */

function parseSightings(v: unknown): CandidateSighting[] {
  let arr: unknown = v;
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s) => s && typeof s === "object")
    .map((s) => {
      const o = s as Record<string, unknown>;
      return {
        sourceType: String(o.sourceType ?? ""),
        sourceUrl: String(o.sourceUrl ?? ""),
        date: String(o.date ?? ""),
      };
    });
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function rowToCandidate(r: Record<string, unknown>): OperatorCandidate {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    currentTitle: String(r.current_title ?? ""),
    company: String(r.company ?? ""),
    industry: String(r.industry ?? ""),
    focusSector: Boolean(r.focus_sector),
    city: String(r.city ?? ""),
    locationVerified: Boolean(r.location_verified),
    sourceType: String(r.source_type ?? ""),
    sourceUrl: String(r.source_url ?? ""),
    dateFound: String(r.date_found ?? ""),
    lastSeen: String(r.last_seen ?? ""),
    referrer: String(r.referrer ?? ""),
    fitNotes: String(r.fit_notes ?? ""),
    status: (String(r.status ?? "Candidate") ||
      "Candidate") as CandidateStatus,
    passReason: String(r.pass_reason ?? ""),
    lastTouch: String(r.last_touch ?? ""),
    nextStep: String(r.next_step ?? ""),
    targetRole: String(r.target_role ?? ""),
    sightings: parseSightings(r.sightings),
    score: typeof r.score === "number" ? r.score : null,
    scoreFactors: parseJson<CandidateScoreFactors | null>(r.score_factors, null),
    scoredAt: String(r.scored_at ?? ""),
    matchedTargets: parseJson<CandidateMatch[]>(r.matched_targets, []),
    conflicts: parseJson<CandidateConflict[]>(r.conflicts, []),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/* ---------------- audit ---------------- */

async function writeAudit(
  entry: Omit<CandidateAuditEntry, "id" | "createdAt">
): Promise<void> {
  const q = sql();
  await q`
    INSERT INTO candidate_audit (
      id, candidate_id, candidate_name, actor, action, summary, before, after
    ) VALUES (
      ${newId()}, ${entry.candidateId}, ${entry.candidateName},
      ${entry.actor}, ${entry.action}, ${entry.summary},
      ${entry.before ? JSON.stringify(entry.before) : null},
      ${entry.after ? JSON.stringify(entry.after) : null}
    )`;
}

type TrailType =
  | "candidate.created"
  | "candidate.updated"
  | "candidate.status"
  | "candidate.merged"
  | "candidate.deleted";

/** Mirror the event into the portal Audit Trail (activity table). */
async function trail(
  type: TrailType,
  actor: string,
  message: string,
  candidate: OperatorCandidate
): Promise<void> {
  try {
    await logActivity({
      type,
      actor,
      message,
      dealId: null,
      execId: null,
      dealName: null,
      execName: candidate.name,
    });
  } catch {
    // The candidate_audit row is the authoritative record; an Audit
    // Trail hiccup must never fail the write itself.
  }
}

export async function getCandidateAudit(
  candidateId: string,
  limit = 50
): Promise<CandidateAuditEntry[]> {
  await ensure();
  const rows = await sql()`
    SELECT * FROM candidate_audit
    WHERE candidate_id = ${candidateId}
    ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r) => {
    const parse = (v: unknown): OperatorCandidate | null => {
      if (v === null || v === undefined) return null;
      if (typeof v === "string") {
        try {
          return JSON.parse(v) as OperatorCandidate;
        } catch {
          return null;
        }
      }
      return v as OperatorCandidate;
    };
    return {
      id: String(r.id),
      candidateId: String(r.candidate_id),
      candidateName: String(r.candidate_name),
      actor: String(r.actor),
      action: String(r.action),
      summary: String(r.summary),
      before: parse(r.before),
      after: parse(r.after),
      createdAt: iso(r.created_at),
    };
  });
}

/* ---------------- reads ---------------- */

export interface CandidateFilters {
  status?: string;
  focusSector?: boolean;
  locationVerified?: boolean;
  q?: string;
  /** "score" = best fit score first, unscored (null) last (Build 2). */
  sort?: string;
}

export async function listCandidates(
  filters: CandidateFilters = {}
): Promise<OperatorCandidate[]> {
  await ensure();
  const rows = await sql()`
    SELECT * FROM operator_candidates ORDER BY updated_at DESC`;
  let out = rows.map(rowToCandidate);
  if (filters.status) out = out.filter((c) => c.status === filters.status);
  if (filters.focusSector !== undefined)
    out = out.filter((c) => c.focusSector === filters.focusSector);
  if (filters.locationVerified !== undefined)
    out = out.filter((c) => c.locationVerified === filters.locationVerified);
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    out = out.filter((c) =>
      [c.name, c.company, c.currentTitle, c.city, c.industry]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }
  if (filters.sort === "score") {
    out = [...out].sort((a, b) => {
      if (a.score === null && b.score === null)
        return a.name.localeCompare(b.name);
      if (a.score === null) return 1; // unscored always last
      if (b.score === null) return -1;
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });
  }
  return out;
}

export async function getCandidate(
  id: string
): Promise<OperatorCandidate | null> {
  await ensure();
  const rows = await sql()`
    SELECT * FROM operator_candidates WHERE id = ${id} LIMIT 1`;
  return rows.length ? rowToCandidate(rows[0]) : null;
}

async function getByKey(key: string): Promise<OperatorCandidate | null> {
  const rows = await sql()`
    SELECT * FROM operator_candidates WHERE dedup_key = ${key} LIMIT 1`;
  return rows.length ? rowToCandidate(rows[0]) : null;
}

/* ---------------- create / merge ---------------- */

export interface CreateResult {
  candidate: OperatorCandidate;
  merged: boolean;
}

/**
 * Create a candidate, or merge a sighting into the existing record when
 * the name+company+title key already exists. Callers must have already
 * enforced validateSource() — the first sighting IS the record's source.
 */
export async function createOrMergeCandidate(
  input: Required<Pick<CandidateInput, "name" | "sourceType" | "sourceUrl">> &
    CandidateInput,
  actor: string
): Promise<CreateResult> {
  await ensure();
  const q = sql();
  const name = input.name.trim();
  const company = (input.company ?? "").trim();
  const currentTitle = (input.currentTitle ?? "").trim();
  const key = candidateKey(name, company, currentTitle);
  const dateFound = (input.dateFound ?? "").trim() || today();
  const sighting: CandidateSighting = {
    sourceType: input.sourceType.trim(),
    sourceUrl: input.sourceUrl.trim(),
    date: dateFound,
  };

  const existing = await getByKey(key);
  if (existing) return mergeSighting(existing, sighting, actor);

  const status =
    input.status && isCandidateStatus(input.status)
      ? input.status
      : "Candidate";
  const candidate: OperatorCandidate = {
    id: newId(),
    name,
    currentTitle,
    company,
    industry: (input.industry ?? "").trim(),
    focusSector: Boolean(input.focusSector),
    city: (input.city ?? "").trim(),
    locationVerified:
      input.locationVerified !== undefined
        ? Boolean(input.locationVerified)
        : Boolean((input.city ?? "").trim()),
    sourceType: sighting.sourceType,
    sourceUrl: sighting.sourceUrl,
    dateFound,
    lastSeen: dateFound,
    referrer: (input.referrer ?? "").trim(),
    fitNotes: input.fitNotes ?? "",
    status,
    passReason: (input.passReason ?? "").trim(),
    lastTouch: (input.lastTouch ?? "").trim(),
    nextStep: (input.nextStep ?? "").trim(),
    targetRole: (input.targetRole ?? "").trim(),
    sightings: [sighting],
    score: null,
    scoreFactors: null,
    scoredAt: "",
    matchedTargets: [],
    conflicts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    await q`
      INSERT INTO operator_candidates (
        id, name, current_title, company, industry, focus_sector, city,
        location_verified, source_type, source_url, date_found, last_seen,
        referrer, fit_notes, status, pass_reason, last_touch, next_step,
        target_role, dedup_key, sightings
      ) VALUES (
        ${candidate.id}, ${candidate.name}, ${candidate.currentTitle},
        ${candidate.company}, ${candidate.industry}, ${candidate.focusSector},
        ${candidate.city}, ${candidate.locationVerified},
        ${candidate.sourceType}, ${candidate.sourceUrl},
        ${candidate.dateFound}, ${candidate.lastSeen}, ${candidate.referrer},
        ${candidate.fitNotes}, ${candidate.status}, ${candidate.passReason},
        ${candidate.lastTouch}, ${candidate.nextStep}, ${candidate.targetRole},
        ${key}, ${JSON.stringify(candidate.sightings)}
      )`;
  } catch (err) {
    // Lost a create race on the unique key — merge instead of failing.
    const raced = await getByKey(key);
    if (raced) return mergeSighting(raced, sighting, actor);
    throw err;
  }

  await writeAudit({
    candidateId: candidate.id,
    candidateName: candidate.name,
    actor,
    action: "created",
    summary: `${actor} added candidate ${candidate.name} (${candidate.currentTitle || "no title"}${candidate.company ? `, ${candidate.company}` : ""}) via ${candidate.sourceType}`,
    before: null,
    after: candidate,
  });
  await trail(
    "candidate.created",
    actor,
    `${actor} added operator candidate ${candidate.name}`,
    candidate
  );
  return { candidate, merged: false };
}

async function mergeSighting(
  existing: OperatorCandidate,
  sighting: CandidateSighting,
  actor: string
): Promise<CreateResult> {
  const q = sql();
  const sightings = [...existing.sightings, sighting];
  const dateFound =
    existing.dateFound && existing.dateFound < sighting.date
      ? existing.dateFound
      : sighting.date || existing.dateFound;
  const lastSeen =
    existing.lastSeen && existing.lastSeen > sighting.date
      ? existing.lastSeen
      : sighting.date || existing.lastSeen;
  await q`
    UPDATE operator_candidates SET
      sightings = ${JSON.stringify(sightings)},
      date_found = ${dateFound},
      last_seen = ${lastSeen},
      updated_at = NOW()
    WHERE id = ${existing.id}`;
  const updated: OperatorCandidate = {
    ...existing,
    sightings,
    dateFound,
    lastSeen,
    updatedAt: new Date().toISOString(),
  };
  await writeAudit({
    candidateId: existing.id,
    candidateName: existing.name,
    actor,
    action: "merged",
    summary: `${actor} logged a new sighting of ${existing.name} via ${sighting.sourceType} (${sighting.sourceUrl}) — merged into the existing candidate record`,
    before: existing,
    after: updated,
  });
  await trail(
    "candidate.merged",
    actor,
    `${actor} logged a new sighting of ${existing.name} (${sighting.sourceType})`,
    updated
  );
  return { candidate: updated, merged: true };
}

/* ---------------- update / delete ---------------- */

export class CandidateCollisionError extends Error {
  conflicting: OperatorCandidate;
  constructor(conflicting: OperatorCandidate) {
    super(
      `A candidate with the same name, company, and title already exists: ${conflicting.name} (${conflicting.id}). Merge into that record instead of renaming this one onto it.`
    );
    this.conflicting = conflicting;
  }
}

const STRING_FIELDS = [
  "name",
  "currentTitle",
  "company",
  "industry",
  "city",
  "sourceType",
  "sourceUrl",
  "dateFound",
  "referrer",
  "fitNotes",
  "passReason",
  "lastTouch",
  "nextStep",
  "targetRole",
] as const;

const BOOL_FIELDS = ["focusSector", "locationVerified"] as const;

export async function updateCandidate(
  id: string,
  patch: CandidateInput,
  actor: string
): Promise<OperatorCandidate | null> {
  await ensure();
  const q = sql();
  const prev = await getCandidate(id);
  if (!prev) return null;

  const next: OperatorCandidate = { ...prev };
  const changes: string[] = [];
  for (const f of STRING_FIELDS) {
    if (!(f in patch) || patch[f] === undefined) continue;
    const v = String(patch[f]).trim();
    if (v !== prev[f]) {
      changes.push(`${f}: ${prev[f] || "—"} → ${v || "—"}`);
      next[f] = v;
    }
  }
  for (const f of BOOL_FIELDS) {
    if (!(f in patch) || patch[f] === undefined) continue;
    const v = Boolean(patch[f]);
    if (v !== prev[f]) {
      changes.push(`${f}: ${prev[f]} → ${v}`);
      next[f] = v;
    }
  }
  if ("status" in patch && patch.status !== undefined) {
    const v = String(patch.status);
    if (!isCandidateStatus(v)) {
      throw new Error(
        `status must be one of: ${CANDIDATE_STATUSES.join(", ")}`
      );
    }
    if (v !== prev.status) {
      changes.push(`status: ${prev.status} → ${v}`);
      next.status = v;
    }
  }

  // The resulting (sourceType, sourceUrl) pair must still obey the
  // source-URL rule whenever either side is being changed.
  if ("sourceType" in patch || "sourceUrl" in patch) {
    const err = validateSource(next.sourceType, next.sourceUrl);
    if (err) throw new Error(err);
  }

  // Identity fields changed → the new key must not belong to another
  // record (merging happens through create, never by silent rename).
  const newKey = candidateKey(next.name, next.company, next.currentTitle);
  const oldKey = candidateKey(prev.name, prev.company, prev.currentTitle);
  if (newKey !== oldKey) {
    const clash = await getByKey(newKey);
    if (clash && clash.id !== id) throw new CandidateCollisionError(clash);
  }

  if (changes.length === 0) return prev;

  await q`
    UPDATE operator_candidates SET
      name = ${next.name}, current_title = ${next.currentTitle},
      company = ${next.company}, industry = ${next.industry},
      focus_sector = ${next.focusSector}, city = ${next.city},
      location_verified = ${next.locationVerified},
      source_type = ${next.sourceType}, source_url = ${next.sourceUrl},
      date_found = ${next.dateFound}, referrer = ${next.referrer},
      fit_notes = ${next.fitNotes}, status = ${next.status},
      pass_reason = ${next.passReason}, last_touch = ${next.lastTouch},
      next_step = ${next.nextStep}, target_role = ${next.targetRole},
      dedup_key = ${newKey}, updated_at = NOW()
    WHERE id = ${id}`;
  next.updatedAt = new Date().toISOString();

  const statusChanged = next.status !== prev.status;
  await writeAudit({
    candidateId: id,
    candidateName: next.name,
    actor,
    action: statusChanged ? "status" : "updated",
    summary: `${actor} updated ${next.name} — ${changes.join("; ")}`,
    before: prev,
    after: next,
  });
  await trail(
    statusChanged ? "candidate.status" : "candidate.updated",
    actor,
    statusChanged
      ? `${actor} moved candidate ${next.name} from ${prev.status} to ${next.status}`
      : `${actor} updated candidate ${next.name}`,
    next
  );
  return next;
}

export async function deleteCandidate(
  id: string,
  actor: string
): Promise<OperatorCandidate | null> {
  await ensure();
  const q = sql();
  const prev = await getCandidate(id);
  if (!prev) return null;
  // Audit first — the entry must exist even though the record is gone.
  await writeAudit({
    candidateId: id,
    candidateName: prev.name,
    actor,
    action: "deleted",
    summary: `${actor} deleted candidate ${prev.name} (${prev.currentTitle || "no title"}${prev.company ? `, ${prev.company}` : ""})`,
    before: prev,
    after: null,
  });
  await q`DELETE FROM operator_candidates WHERE id = ${id}`;
  await trail(
    "candidate.deleted",
    actor,
    `${actor} deleted operator candidate ${prev.name}`,
    prev
  );
  return prev;
}

/* ---------------- Build 2: scoring / matching persistence ---------------- */

export interface ScoringWrite {
  score: number | null;
  scoreFactors: CandidateScoreFactors | null;
  scoredAt: string;
  matchedTargets: CandidateMatch[];
  conflicts: CandidateConflict[];
}

/**
 * Persist one candidate's score + matches + conflicts. Writes a
 * candidate_audit "scored" entry (the authoritative record) but does
 * NOT mirror to the Audit Trail per candidate — a bulk rescore would
 * flood the trail; logScoringRun() writes one summary entry instead.
 * Returns false when nothing actually changed.
 */
export async function applyScoring(
  id: string,
  write: ScoringWrite,
  actor: string
): Promise<boolean> {
  await ensure();
  const q = sql();
  const prev = await getCandidate(id);
  if (!prev) return false;
  const changed =
    prev.score !== write.score ||
    JSON.stringify(prev.scoreFactors) !== JSON.stringify(write.scoreFactors) ||
    JSON.stringify(prev.matchedTargets) !== JSON.stringify(write.matchedTargets) ||
    JSON.stringify(prev.conflicts) !== JSON.stringify(write.conflicts);
  if (!changed) return false;
  await q`
    UPDATE operator_candidates SET
      score = ${write.score},
      score_factors = ${write.scoreFactors ? JSON.stringify(write.scoreFactors) : null},
      scored_at = ${write.scoredAt},
      matched_targets = ${JSON.stringify(write.matchedTargets)},
      conflicts = ${JSON.stringify(write.conflicts)},
      updated_at = NOW()
    WHERE id = ${id}`;
  const next: OperatorCandidate = {
    ...prev,
    score: write.score,
    scoreFactors: write.scoreFactors,
    scoredAt: write.scoredAt,
    matchedTargets: write.matchedTargets,
    conflicts: write.conflicts,
    updatedAt: new Date().toISOString(),
  };
  await writeAudit({
    candidateId: id,
    candidateName: prev.name,
    actor,
    action: "scored",
    summary:
      write.score === null
        ? `${actor} rescored ${prev.name}: unscored (location unverified)`
        : `${actor} rescored ${prev.name}: score ${write.score}/100, ${write.matchedTargets.length} match(es), ${write.conflicts.length} conflict flag(s)`,
    before: prev,
    after: next,
  });
  return true;
}

/** One Audit Trail summary line per bulk rescore run. */
export async function logScoringRun(actor: string, message: string): Promise<void> {
  try {
    await logActivity({
      type: "candidate.updated",
      actor,
      message,
      dealId: null,
      execId: null,
      dealName: null,
      execName: null,
    });
  } catch {
    // Best-effort, same contract as the per-candidate trail mirrors.
  }
}

/* -------- operator-needed snapshot (refreshed by every rescore) -------- */

export interface OperatorNeededEntry {
  type: "company" | "deal";
  id: string;
  name: string;
  sector: string;
  city: string;
  bestMatchScore: number | null;
}

export interface MatchState {
  computedAt: string;
  strongThreshold: number;
  poolCompanies: number;
  poolDeals: number;
  operatorNeededTotal: number;
  operatorNeeded: OperatorNeededEntry[];
}

export async function saveMatchState(state: MatchState): Promise<void> {
  await ensure();
  const q = sql();
  await q`
    INSERT INTO operator_match_state (id, payload, computed_at)
    VALUES ('latest', ${JSON.stringify(state)}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      payload = EXCLUDED.payload, computed_at = NOW()`;
}

export async function getMatchState(): Promise<MatchState | null> {
  await ensure();
  const rows = await sql()`
    SELECT payload FROM operator_match_state WHERE id = 'latest' LIMIT 1`;
  if (!rows.length) return null;
  return parseJson<MatchState | null>(rows[0].payload, null);
}
