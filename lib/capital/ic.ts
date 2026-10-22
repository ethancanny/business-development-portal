import { sql, newId, str, isoOrNull } from "../platform/db";
import { ensureCapital, IC_AREAS, IC_DECISIONS } from "./schema";
import { getDealContext } from "../diligence/service";
import { getCurrentMemo, type MemoRow } from "../diligence/memo";

/**
 * Investment committee (Phase 7, WS-B) — scorecard + decision log.
 *
 * The IC memo IS the Phase 5B diligence memo (lib/diligence/memo.ts
 * getCurrentMemo) — this module never creates another memo; it only
 * bundles the current memo (+ its stale flag) with the capital-owned
 * scorecard and decision log.
 */

const IC_AREA_KEYS: readonly string[] = IC_AREAS.map((a) => a.key);
const VOTE_VALUES = ["approve", "decline", "abstain"] as const;

function jsonObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v))
    return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim()) {
    try {
      const p: unknown = JSON.parse(v);
      return p && typeof p === "object" && !Array.isArray(p)
        ? (p as Record<string, unknown>)
        : {};
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
      const p: unknown = JSON.parse(v);
      return Array.isArray(p) ? (p as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/* ----------------------------- scorecard ----------------------------- */

export interface IcScorecard {
  scores: Record<string, number | null>;
  notes: Record<string, string>;
  updatedBy: string;
  updatedAt: string | null;
}

const EMPTY_SCORECARD: IcScorecard = {
  scores: {},
  notes: {},
  updatedBy: "",
  updatedAt: null,
};

export async function getScorecard(dealId: string): Promise<IcScorecard> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT scores, notes, updated_by, updated_at
    FROM capital.ic_scorecards
    WHERE deal_id = ${dealId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) return { ...EMPTY_SCORECARD };
  const r = rows[0] as Record<string, unknown>;
  const rawScores = jsonObj(r.scores);
  const scores: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(rawScores)) {
    scores[k] = typeof v === "number" && isFinite(v) ? v : null;
  }
  const rawNotes = jsonObj(r.notes);
  const notes: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawNotes)) {
    notes[k] = typeof v === "string" ? v : String(v ?? "");
  }
  return {
    scores,
    notes,
    updatedBy: str(r.updated_by),
    updatedAt: isoOrNull(r.updated_at),
  };
}

/**
 * Save the IC scorecard for a deal (merge semantics: provided entries
 * overwrite, unmentioned areas keep their stored values; a null score
 * clears an area). Score keys must be IC_AREAS keys and values
 * integers 1–5 or null — anything else is invalid_score.
 */
export async function saveScorecard(
  dealId: string,
  input: {
    scores?: Record<string, number | null>;
    notes?: Record<string, string> | string;
  },
  actor: string
): Promise<IcScorecard> {
  await ensureCapital();
  const ctx = await getDealContext(dealId);
  if (!ctx) throw new Error("deal_not_found");

  const scoresPatch = input.scores ?? {};
  for (const [key, value] of Object.entries(scoresPatch)) {
    if (!IC_AREA_KEYS.includes(key)) throw new Error("invalid_score");
    if (
      value !== null &&
      (typeof value !== "number" ||
        !isFinite(value) ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 5)
    ) {
      throw new Error("invalid_score");
    }
  }
  const notesPatch: Record<string, string> =
    typeof input.notes === "string"
      ? { general: input.notes }
      : Object.fromEntries(
          Object.entries(input.notes ?? {}).map(([k, v]) => [
            k,
            typeof v === "string" ? v : String(v ?? ""),
          ])
        );

  const current = await getScorecard(dealId);
  const scores = { ...current.scores, ...scoresPatch };
  const notes = { ...current.notes, ...notesPatch };

  const db = sql();
  const existing = await db`
    SELECT id FROM capital.ic_scorecards
    WHERE deal_id = ${dealId} AND deleted_at IS NULL LIMIT 1`;
  if (existing.length) {
    await db`
      UPDATE capital.ic_scorecards
      SET scores = ${JSON.stringify(scores)}::jsonb,
          notes = ${JSON.stringify(notes)}::jsonb,
          updated_by = ${actor}, updated_at = now()
      WHERE deal_id = ${dealId} AND deleted_at IS NULL`;
  } else {
    await db`
      INSERT INTO capital.ic_scorecards (id, deal_id, scores, notes, updated_by)
      VALUES (${`ics_${newId()}`}, ${dealId},
        ${JSON.stringify(scores)}::jsonb},
        ${JSON.stringify(notes)}::jsonb, ${actor})`;
  }
  return getScorecard(dealId);
}

/* ----------------------------- decisions ----------------------------- */

export interface IcVote {
  voter: string;
  vote: string;
}

export interface IcDecision {
  id: string;
  dealId: string;
  decision: string;
  conditions: string;
  votes: IcVote[];
  notes: string;
  decidedBy: string;
  decidedAt: string;
  createdAt: string;
  updatedAt: string;
}

function rowToDecision(r: Record<string, unknown>): IcDecision {
  return {
    id: str(r.id),
    dealId: str(r.deal_id),
    decision: str(r.decision),
    conditions: str(r.conditions),
    votes: jsonArr<IcVote>(r.votes).map((v) => ({
      voter: typeof v?.voter === "string" ? v.voter : String(v?.voter ?? ""),
      vote: typeof v?.vote === "string" ? v.vote : String(v?.vote ?? ""),
    })),
    notes: str(r.notes),
    decidedBy: str(r.decided_by),
    decidedAt: isoOrNull(r.decided_at) ?? "",
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

const DECISION_COLS = `id, deal_id, decision, conditions, votes, notes,
  decided_by, decided_at, created_at, updated_at`;

export async function listDecisions(dealId: string): Promise<IcDecision[]> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(DECISION_COLS)} FROM capital.ic_decisions
    WHERE deal_id = ${dealId} AND deleted_at IS NULL
    ORDER BY decided_at DESC, created_at DESC LIMIT 50`;
  return rows.map((r) => rowToDecision(r as Record<string, unknown>));
}

/**
 * Log an IC decision. decision must be one of IC_DECISIONS
 * (invalid_decision); each vote's vote must be
 * approve|decline|abstain (invalid_vote). decided_by/at are stamped
 * from the actor / now.
 */
export async function logDecision(
  dealId: string,
  input: {
    decision?: string;
    conditions?: string;
    votes?: Array<{ voter?: unknown; vote?: unknown }>;
    notes?: string;
  },
  actor: string
): Promise<IcDecision> {
  await ensureCapital();
  const ctx = await getDealContext(dealId);
  if (!ctx) throw new Error("deal_not_found");
  const decision = (input.decision ?? "").trim();
  if (!(IC_DECISIONS as readonly string[]).includes(decision)) {
    throw new Error("invalid_decision");
  }
  const rawVotes = Array.isArray(input.votes) ? input.votes : [];
  const votes: IcVote[] = [];
  for (const raw of rawVotes) {
    const vote =
      raw && typeof raw.vote === "string" ? raw.vote.trim() : "";
    if (!(VOTE_VALUES as readonly string[]).includes(vote)) {
      throw new Error("invalid_vote");
    }
    votes.push({
      voter:
        raw && typeof raw.voter === "string" ? raw.voter.trim() : "",
      vote,
    });
  }
  const db = sql();
  const id = `icd_${newId()}`;
  await db`
    INSERT INTO capital.ic_decisions
      (id, deal_id, decision, conditions, votes, notes, decided_by, decided_at)
    VALUES (${id}, ${dealId}, ${decision},
      ${(input.conditions ?? "").trim()},
      ${JSON.stringify(votes)}::jsonb,
      ${(input.notes ?? "").trim()}, ${actor}, now())`;
  const rows = await db`
    SELECT ${db.unsafe(DECISION_COLS)} FROM capital.ic_decisions
    WHERE id = ${id} LIMIT 1`;
  return rowToDecision(rows[0] as Record<string, unknown>);
}

/* ------------------------------- bundle ------------------------------ */

export interface IcBundle {
  scorecard: IcScorecard;
  memo: { memo: MemoRow | null; stale: boolean };
  decisions: IcDecision[];
}

export async function getIcBundle(dealId: string): Promise<IcBundle> {
  const ctx = await getDealContext(dealId);
  if (!ctx) throw new Error("deal_not_found");
  const [scorecard, memo, decisions] = await Promise.all([
    getScorecard(dealId),
    getCurrentMemo(dealId),
    listDecisions(dealId),
  ]);
  return { scorecard, memo, decisions };
}
