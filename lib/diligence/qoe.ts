import { sql, newId, str, numOrNull, isoOrNull } from "../platform/db";
import { ensureDiligence } from "./schema";
import { requireWorkspace } from "./service";
import {
  getCompanyAdjustments,
  decideAdjustment,
  getCurrentAnalysis,
  type AdjustmentRecord,
} from "../finanalysis/service";
import {
  listSets,
  getSet,
  createAdjustedDraft,
  updateSet,
  postSet,
  type LinePatch,
  type StatementSet,
} from "../financials/service";

/**
 * QoE workbench (Phase 5, spec §3).
 *
 * Writes go ONLY through the Phase 4 / 4B service layer:
 * - engine-suggested adjustments are decided via finanalysis'
 *   decideAdjustment (which applies accepted items to the adjusted
 *   draft through financials' updateSet);
 * - workbench-added (manual) adjustments are recorded in
 *   diligence.qoe_manual_adjustments and, on accept, applied with the
 *   EXACT convention decideAdjustment uses (EBITDA line moves by the
 *   signed amount; one 'QoE: <label>' opex_detail line carries the
 *   inverse expense effect) through financials' createAdjustedDraft +
 *   updateSet;
 * - posting the adjusted set goes through financials' postSet with an
 *   override note naming every accepted adjustment (the Phase 4 EBITDA
 *   gate requirement).
 *
 * SDE vs EBITDA are computed and labeled as DISTINCT views and never
 * blended: the SDE view is adjusted EBITDA plus owner-compensation
 * add-backs, shown separately (Ethan's standing rule).
 */

export interface ManualAdjustmentRow {
  id: string;
  workspaceId: string;
  companyId: string;
  reportedSetId: string;
  adjustedSetId: string | null;
  kind: string;
  label: string;
  amount: number | null;
  direction: string;
  rationale: string;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decidedAmount: number | null;
  createdAt: string;
  updatedAt: string;
}

function rowToManual(r: Record<string, unknown>): ManualAdjustmentRow {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    companyId: str(r.company_id),
    reportedSetId: str(r.reported_set_id),
    adjustedSetId: r.adjusted_set_id ? str(r.adjusted_set_id) : null,
    kind: str(r.kind) || "other",
    label: str(r.label),
    amount: numOrNull(r.amount),
    direction: str(r.direction) || "add",
    rationale: str(r.rationale),
    status: str(r.status) || "proposed",
    decidedBy: r.decided_by ? str(r.decided_by) : null,
    decidedAt: isoOrNull(r.decided_at),
    decidedAmount: numOrNull(r.decided_amount),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function listManualAdjustments(
  workspaceId: string
): Promise<ManualAdjustmentRow[]> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.qoe_manual_adjustments
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    ORDER BY created_at DESC`;
  return rows.map((r) => rowToManual(r as Record<string, unknown>));
}

export interface QoeWorkbench {
  companyId: string;
  engineAdjustments: AdjustmentRecord[];
  manualAdjustments: ManualAdjustmentRow[];
  bridge: {
    reportedSetId: string;
    reportedEbitda: number | null;
    items: { label: string; amount: number }[];
    adjustedEbitda: number | null;
    adjustedSetId: string | null;
  } | null;
  /** Distinct views — never blended (standing rule). */
  ebitdaView: {
    reported: number | null;
    adjusted: number | null;
  };
  sdeView: {
    /** Adjusted EBITDA + accepted owner-comp add-backs. */
    value: number | null;
    ownerCompAddBacks: number;
    basis: string;
  };
  reportedSets: StatementSet[];
  adjustedDrafts: StatementSet[];
  adjustedPosted: StatementSet[];
  analysisStatus: string | null;
}

export async function getQoeWorkbench(
  workspaceId: string
): Promise<QoeWorkbench> {
  const ws = await requireWorkspace(workspaceId);
  if (!ws.companyId) throw new Error("company_required");
  const companyId = ws.companyId;
  const [engineAdjustments, manualAdjustments, current, reported, drafts, postedAdj] =
    await Promise.all([
      getCompanyAdjustments(companyId),
      listManualAdjustments(workspaceId),
      getCurrentAnalysis(companyId).catch(() => null),
      listSets({ companyId, status: "posted", layer: "reported", limit: 50 }),
      listSets({ companyId, status: "draft", layer: "adjusted", limit: 50 }),
      listSets({ companyId, status: "posted", layer: "adjusted", limit: 50 }),
    ]);
  const bridge = current?.payload.marginBridge ?? null;
  // SDE view: adjusted EBITDA plus owner-compensation add-backs
  // (engine-accepted + manual-accepted owner_comp items). Kept as its
  // own labeled view; it is never summed into the EBITDA figures.
  let ownerCompAddBacks = 0;
  for (const adj of engineAdjustments) {
    if (adj.status === "accepted" && adj.kind === "owner_comp") {
      ownerCompAddBacks += adj.decidedAmount ?? adj.amount ?? 0;
    }
  }
  for (const adj of manualAdjustments) {
    if (adj.status === "accepted" && adj.kind === "owner_comp") {
      ownerCompAddBacks += adj.decidedAmount ?? adj.amount ?? 0;
    }
  }
  const adjusted = bridge?.adjustedEbitda ?? null;
  return {
    companyId,
    engineAdjustments,
    manualAdjustments,
    bridge,
    ebitdaView: {
      reported: bridge?.reportedEbitda ?? null,
      adjusted,
    },
    sdeView: {
      value: adjusted != null ? adjusted + ownerCompAddBacks : null,
      ownerCompAddBacks,
      basis:
        "Adjusted EBITDA plus owner-compensation add-backs. Shown as a " +
        "separate SDE view only — never blended into EBITDA.",
    },
    reportedSets: reported.items,
    adjustedDrafts: drafts.items,
    adjustedPosted: postedAdj.items,
    analysisStatus: current?.analysis.status ?? null,
  };
}

/** Decide an engine-suggested adjustment (4B service passthrough). */
export async function decideEngineAdjustment(
  adjustmentId: string,
  input: { decision: string; amount?: number | null; inputValue?: number | null },
  actor: string
): Promise<AdjustmentRecord> {
  return decideAdjustment(adjustmentId, input, actor);
}

export async function createManualAdjustment(
  workspaceId: string,
  input: {
    reportedSetId: string;
    kind?: string;
    label: string;
    amount?: number | null;
    direction?: string;
    rationale?: string;
  },
  actor: string
): Promise<ManualAdjustmentRow> {
  const ws = await requireWorkspace(workspaceId);
  if (!ws.companyId) throw new Error("company_required");
  const label = (input.label ?? "").trim();
  if (!label) throw new Error("label_required");
  const reportedFull = await getSet(input.reportedSetId);
  if (!reportedFull) throw new Error("reported_set_not_found");
  const reported = reportedFull.set;
  if (reported.companyId !== ws.companyId)
    throw new Error("reported_set_company_mismatch");
  if (reported.status !== "posted") throw new Error("reported_not_posted");
  if (reported.layer !== "reported") throw new Error("not_reported");
  const db = sql();
  const id = `qma_${newId()}`;
  await db`
    INSERT INTO diligence.qoe_manual_adjustments
      (id, workspace_id, company_id, reported_set_id, kind, label, amount,
       direction, rationale, created_by)
    VALUES (${id}, ${workspaceId}, ${ws.companyId}, ${input.reportedSetId},
      ${input.kind ?? "other"}, ${label}, ${input.amount ?? null},
      ${input.direction === "subtract" ? "subtract" : "add"},
      ${(input.rationale ?? "").trim()}, ${actor})`;
  const rows = await db`
    SELECT * FROM diligence.qoe_manual_adjustments WHERE id = ${id} LIMIT 1`;
  return rowToManual(rows[0] as Record<string, unknown>);
}

/**
 * Decide a manual adjustment. Accept applies it to the adjusted layer
 * with the same updateSet convention finanalysis' decideAdjustment
 * uses; the reported (as-reported) layer is never touched.
 */
export async function decideManualAdjustment(
  adjustmentId: string,
  input: { decision: string; amount?: number | null },
  actor: string
): Promise<ManualAdjustmentRow> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.qoe_manual_adjustments
    WHERE id = ${adjustmentId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new Error("adjustment_not_found");
  const row = rowToManual(rows[0] as Record<string, unknown>);
  if (row.status !== "proposed") throw new Error("adjustment_already_decided");
  const decision = (input.decision ?? "").trim().toLowerCase();

  if (decision === "reject" || decision === "rejected") {
    await db`
      UPDATE diligence.qoe_manual_adjustments
      SET status = 'rejected', decided_by = ${actor}, decided_at = now(),
          decided_amount = ${input.amount ?? null}, updated_at = now()
      WHERE id = ${adjustmentId}`;
  } else if (decision === "accept" || decision === "accepted") {
    const finalAmount =
      input.amount !== undefined && input.amount !== null
        ? Number(input.amount)
        : row.amount;
    if (finalAmount === null || !isFinite(finalAmount))
      throw new Error("amount_required");

    const reportedFull = await getSet(row.reportedSetId);
    if (!reportedFull) throw new Error("reported_set_not_found");
    const reported = reportedFull.set;
    if (reported.status !== "posted") throw new Error("reported_not_posted");
    if (reported.layer !== "reported") throw new Error("not_reported");

    const draftSets = await listSets({
      companyId: row.companyId,
      status: "draft",
      layer: "adjusted",
      limit: 50,
    });
    const reusable = draftSets.items
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
        source: { manualAdjustmentId: row.id },
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
      source: { manualAdjustmentId: row.id },
      sort: linePatches.length,
      isSubtotal: false,
    });
    await updateSet(adjustedDraftId, { lines: linePatches, actor });

    await db`
      UPDATE diligence.qoe_manual_adjustments
      SET status = 'accepted', decided_by = ${actor}, decided_at = now(),
          decided_amount = ${finalAmount},
          adjusted_set_id = ${adjustedDraftId}, updated_at = now()
      WHERE id = ${adjustmentId}`;
  } else {
    throw new Error("invalid_decision");
  }
  const saved = await db`
    SELECT * FROM diligence.qoe_manual_adjustments
    WHERE id = ${adjustmentId} LIMIT 1`;
  return rowToManual(saved[0] as Record<string, unknown>);
}

/**
 * Post the adjusted (QoE) set. The Phase 4 EBITDA gate requires an
 * override note when the posted EBITDA differs from the computed
 * figure; the note names every accepted adjustment feeding this set so
 * the variance is explained on the record.
 */
export async function postAdjustedSet(
  workspaceId: string,
  adjustedSetId: string,
  actor: string
): Promise<{ set: StatementSet; overrideNote: string }> {
  const ws = await requireWorkspace(workspaceId);
  if (!ws.companyId) throw new Error("company_required");
  const full = await getSet(adjustedSetId);
  if (!full) throw new Error("set_not_found");
  if (full.set.companyId !== ws.companyId)
    throw new Error("set_company_mismatch");
  if (full.set.layer !== "adjusted") throw new Error("not_adjusted_layer");
  const [engine, manual] = await Promise.all([
    getCompanyAdjustments(ws.companyId),
    listManualAdjustments(workspaceId),
  ]);
  const fmt = (n: number) =>
    `${n < 0 ? "−" : "+"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
  const names: string[] = [];
  for (const adj of engine) {
    if (adj.status === "accepted" && adj.adjustedSetId === adjustedSetId) {
      const amt = adj.decidedAmount ?? adj.amount ?? 0;
      names.push(
        `${adj.label} (${fmt(adj.direction === "subtract" ? -amt : amt)})`
      );
    }
  }
  for (const adj of manual) {
    if (adj.status === "accepted" && adj.adjustedSetId === adjustedSetId) {
      const amt = adj.decidedAmount ?? adj.amount ?? 0;
      names.push(
        `${adj.label} (${fmt(adj.direction === "subtract" ? -amt : amt)})`
      );
    }
  }
  const overrideNote =
    `QoE adjusted set posted from the diligence workbench. Accepted ` +
    `adjustments: ${names.length ? names.join("; ") : "none recorded"}.`;
  const result = await postSet(
    adjustedSetId,
    { ebitdaOverrideNote: overrideNote },
    actor
  );
  return { set: result.set, overrideNote };
}
