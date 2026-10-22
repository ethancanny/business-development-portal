import { sql, newId, str, isoOrNull } from "../platform/db";
import { ensureValueCreation, EXIT_AREAS } from "./schema";
import { VcError, requirePlan, refreshPlanSummary } from "./service";
import { getCompanyFinancials } from "../financials/service";

/**
 * Exit readiness (Phase 6, WS-B) — the plan's exit-readiness scorecard.
 *
 * Table is WS-A's: valuecreation.exit_readiness(id, plan_id UNIQUE
 * live, scores jsonb, timestamps, deleted_at). Scores are keyed by
 * EXIT_AREAS area key; each cell is {score: 1–5 | null, notes}.
 * overall = round1(mean(present scores) × 20) — a 0–100 scale — or
 * null when no area has been scored yet.
 *
 * hints are ADVISORY ONLY: a financial-readiness suggestion computed
 * live from the financials service (posted periods + flags). Hints
 * are returned alongside the scores but are never written into them.
 * Pattern mirrors diligence's getScorecard (auto-create on read).
 * This module imports refreshPlanSummary from ./service; the service
 * does NOT import readiness, so there is no cycle.
 */

export interface ExitScoreCell {
  score: number | null;
  notes: string;
}

export interface ExitReadinessHints {
  financial_readiness: {
    postedPeriods: number;
    flags: string[];
    suggestion: string;
  };
}

export interface ExitReadiness {
  id: string;
  planId: string;
  scores: Record<string, ExitScoreCell>;
  overall: number | null;
  updatedAt: string;
  hints: ExitReadinessHints;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function parseScores(v: unknown): Record<string, ExitScoreCell> {
  let obj: Record<string, unknown> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    obj = v as Record<string, unknown>;
  } else if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) {
        obj = p as Record<string, unknown>;
      }
    } catch {
      obj = {};
    }
  }
  const out: Record<string, ExitScoreCell> = {};
  for (const [k, cell] of Object.entries(obj)) {
    const rec =
      cell && typeof cell === "object"
        ? (cell as Record<string, unknown>)
        : {};
    out[k] = {
      score:
        typeof rec.score === "number" && isFinite(rec.score)
          ? Math.min(5, Math.max(1, Math.round(rec.score)))
          : null,
      notes: typeof rec.notes === "string" ? rec.notes : "",
    };
  }
  return out;
}

/** EXIT_AREAS keys, read defensively (entries are {key, label}). */
function exitAreaKeys(): string[] {
  const raw = EXIT_AREAS as unknown;
  if (!Array.isArray(raw)) return [];
  const keys: string[] = [];
  for (const e of raw as unknown[]) {
    if (typeof e === "string" && e) keys.push(e);
    else if (
      e &&
      typeof e === "object" &&
      typeof (e as { key?: unknown }).key === "string"
    ) {
      keys.push((e as { key: string }).key);
    }
  }
  return keys;
}

function overallOf(scores: Record<string, ExitScoreCell>): number | null {
  const present = Object.values(scores)
    .map((c) => c.score)
    .filter((s): s is number => typeof s === "number");
  if (!present.length) return null;
  const mean = present.reduce((a, b) => a + b, 0) / present.length;
  return round1(mean * 20);
}

/**
 * Advisory financial-readiness hint from the financials service.
 * Never throws: a financials failure degrades to an honest
 * "unavailable" hint rather than failing the readiness read.
 */
async function buildHints(companyId: string): Promise<ExitReadinessHints> {
  try {
    const { summary } = await getCompanyFinancials(companyId);
    const postedPeriods = summary.periods.length;
    const flags = [...summary.flags];
    let suggestion: string;
    if (postedPeriods === 0) {
      suggestion =
        "No posted financial statements yet — post at least two annual periods (ideally three) before marketing the business.";
    } else if (flags.includes("does_not_balance")) {
      suggestion =
        "The latest posted statements do not balance — resolve the balance-sheet variance before sharing financials with buyers.";
    } else if (flags.includes("ebitda_variance")) {
      suggestion =
        "Stated EBITDA does not reconcile to the statements — clear the EBITDA variance (or document the override) before buyer review.";
    } else if (postedPeriods < 3) {
      suggestion = `Only ${postedPeriods} posted period(s) — buyers typically expect three years of posted financials; keep posting to build the package.`;
    } else {
      suggestion =
        "Three or more posted periods with no blocking flags — the financial package looks buyer-ready.";
    }
    return {
      financial_readiness: { postedPeriods, flags, suggestion },
    };
  } catch (err) {
    console.error(
      "[valuecreation:readiness] hints failed for company",
      companyId,
      err instanceof Error ? err.message : String(err)
    );
    return {
      financial_readiness: {
        postedPeriods: 0,
        flags: [],
        suggestion:
          "Financial summary unavailable — post financial statements to get a readiness suggestion.",
      },
    };
  }
}

interface ReadinessRow {
  id: string;
  planId: string;
  scores: Record<string, ExitScoreCell>;
  updatedAt: string;
}

async function fetchOrCreateRow(planId: string): Promise<ReadinessRow> {
  const db = sql();
  let rows = await db`
    SELECT id, plan_id, scores, updated_at FROM valuecreation.exit_readiness
    WHERE plan_id = ${planId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) {
    const id = `vcr_${newId()}`;
    await db`
      INSERT INTO valuecreation.exit_readiness (id, plan_id, scores)
      VALUES (${id}, ${planId}, ${JSON.stringify({})}::jsonb)`;
    rows = await db`
      SELECT id, plan_id, scores, updated_at FROM valuecreation.exit_readiness
      WHERE plan_id = ${planId} AND deleted_at IS NULL LIMIT 1`;
  }
  const r = rows[0] as Record<string, unknown>;
  return {
    id: str(r.id),
    planId: str(r.plan_id),
    scores: parseScores(r.scores),
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

/**
 * Read the plan's exit readiness (auto-creating the empty row on
 * first read). Stored scores are merged over the EXIT_AREAS keys so
 * every known area is always present in the payload.
 */
export async function getExitReadiness(
  planId: string
): Promise<ExitReadiness> {
  await ensureValueCreation();
  const plan = await requirePlan(planId);
  const row = await fetchOrCreateRow(planId);
  const scores: Record<string, ExitScoreCell> = {};
  for (const key of exitAreaKeys()) {
    scores[key] = row.scores[key] ?? { score: null, notes: "" };
  }
  for (const [k, v] of Object.entries(row.scores)) {
    if (!(k in scores)) scores[k] = v;
  }
  return {
    id: row.id,
    planId: row.planId,
    scores,
    overall: overallOf(scores),
    updatedAt: row.updatedAt,
    hints: await buildHints(plan.companyId),
  };
}

/**
 * Persist score updates: scores are clamped to 1–5 integers or null
 * and merged over the stored cells. Refreshes the plan summary (its
 * exit_overall) afterwards and returns the fresh readiness read.
 */
export async function updateExitReadiness(
  planId: string,
  input: { scores: Record<string, { score: number | null; notes?: string }> },
  actor: string
): Promise<ExitReadiness> {
  await ensureValueCreation();
  void actor;
  await requirePlan(planId);
  if (!input.scores || typeof input.scores !== "object") {
    throw new VcError("scores_required");
  }
  const row = await fetchOrCreateRow(planId);
  const merged: Record<string, ExitScoreCell> = { ...row.scores };
  for (const [k, cell] of Object.entries(input.scores)) {
    const rawScore = cell?.score;
    merged[k] = {
      score:
        typeof rawScore === "number" && isFinite(rawScore)
          ? Math.min(5, Math.max(1, Math.round(rawScore)))
          : null,
      notes:
        typeof cell?.notes === "string"
          ? cell.notes
          : (merged[k]?.notes ?? ""),
    };
  }
  const db = sql();
  await db`
    UPDATE valuecreation.exit_readiness
    SET scores = ${JSON.stringify(merged)}::jsonb, updated_at = now()
    WHERE id = ${row.id}`;
  await refreshPlanSummary(planId);
  return getExitReadiness(planId);
}
