import { sql, newId, str, num, numOrNull, isoOrNull } from "../platform/db";
import { onEvent } from "../platform/events";
import { logUsage } from "../platform/usage";
import {
  ensureDiligence,
  CHECKLIST_TEMPLATE,
  CHECKLIST_STATUSES,
  WORKSTREAMS,
  RED_FLAG_STATUSES,
  FINDING_STATUSES,
  CLOSING_STATUSES,
  CLOSING_CATEGORIES,
  LICENSE_TRANSFERABILITY,
} from "./schema";
import {
  getRoomChecklist,
  getRoomIndex,
  listFolders,
  listRooms,
  type ChecklistItemRow as RoomChecklistItem,
} from "../dataroom/service";
import { getCurrentAnalysis } from "../finanalysis/service";
import { listTemplates } from "../directory/service";

/**
 * Diligence service (Phase 5) — workspaces, checklists, request lists,
 * findings → deal terms, contract & license registers, tax module,
 * controls scorecard, site visits, red flags, closing checklist.
 *
 * Cross-module data flows ONLY through service functions:
 * - data room status via lib/dataroom/service (getRoomIndex /
 *   getRoomChecklist / listFolders / listRooms),
 * - analysis anomalies via lib/finanalysis/service (getCurrentAnalysis),
 * - email templates via lib/directory/service (listTemplates).
 * No cross-schema SQL against dataroom / financials / finanalysis /
 * directory tables anywhere in this module. core.* reads are platform
 * foundation data (the same joins lib/dataroom/service itself uses).
 */

const DAY_MS = 86400000;

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

/* ------------------------------ workspaces ----------------------------- */

export interface DealContext {
  dealId: string;
  companyId: string | null;
  dealName: string;
  companyName: string;
  stage: string;
  /** Claimed-by partner name (legacy deals.owner; "" when unclaimed).
   * Added for the Due Diligence hub cards (WS-C nav restructure). */
  owner: string;
}

export async function getDealContext(
  dealId: string
): Promise<DealContext | null> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT cd.id, cd.company_id, cd.stage,
      coalesce(ld.company_name, co.name, '') AS deal_name,
      coalesce(co.name, '') AS company_name,
      coalesce(ld.owner, '') AS deal_owner
    FROM core.deals cd
    LEFT JOIN deals ld ON ld.id = cd.id
    LEFT JOIN core.companies co ON co.id = cd.company_id
    WHERE cd.id = ${dealId} LIMIT 1`;
  if (!rows.length) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    dealId: str(r.id),
    companyId: r.company_id ? str(r.company_id) : null,
    dealName: str(r.deal_name),
    companyName: str(r.company_name),
    stage: str(r.stage),
    owner: str(r.deal_owner),
  };
}

export interface WorkspaceRow {
  id: string;
  dealId: string;
  companyId: string | null;
  status: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function rowToWorkspace(r: Record<string, unknown>): WorkspaceRow {
  return {
    id: str(r.id),
    dealId: str(r.deal_id),
    companyId: r.company_id ? str(r.company_id) : null,
    status: str(r.status) || "active",
    notes: str(r.notes),
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function getWorkspaceById(
  id: string
): Promise<WorkspaceRow | null> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.workspaces
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  return rows.length ? rowToWorkspace(rows[0] as Record<string, unknown>) : null;
}

export async function getWorkspaceByDeal(
  dealId: string
): Promise<WorkspaceRow | null> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.workspaces
    WHERE deal_id = ${dealId} AND deleted_at IS NULL LIMIT 1`;
  return rows.length ? rowToWorkspace(rows[0] as Record<string, unknown>) : null;
}

export async function requireWorkspace(id: string): Promise<WorkspaceRow> {
  const ws = await getWorkspaceById(id);
  if (!ws) throw new Error("workspace_not_found");
  return ws;
}

/**
 * Create the (single) diligence workspace for a deal and seed it:
 * the default workstream checklist, the five BPMN process diagrams,
 * an empty tax profile and scorecard. Idempotent per deal — an active
 * workspace is returned with existed=true.
 */
export async function createWorkspace(
  dealId: string,
  actor: string
): Promise<{ workspace: WorkspaceRow; existed: boolean }> {
  await ensureDiligence();
  const existing = await getWorkspaceByDeal(dealId);
  if (existing) return { workspace: existing, existed: true };
  const ctx = await getDealContext(dealId);
  if (!ctx) throw new Error("deal_not_found");
  const db = sql();
  const id = `dil_${newId()}`;
  await db`
    INSERT INTO diligence.workspaces (id, deal_id, company_id, created_by)
    VALUES (${id}, ${dealId}, ${ctx.companyId}, ${actor})`;
  let sort = 0;
  for (const item of CHECKLIST_TEMPLATE) {
    sort += 10;
    await db`
      INSERT INTO diligence.checklist_items
        (id, workspace_id, workstream, title, sort, created_by)
      VALUES (${`dci_${newId()}`}, ${id}, ${item.workstream}, ${item.title},
        ${sort}, ${actor})`;
  }
  await db`
    INSERT INTO diligence.tax_profiles (id, workspace_id)
    VALUES (${`tax_${newId()}`}, ${id})`;
  await db`
    INSERT INTO diligence.scorecards (id, workspace_id)
    VALUES (${`sco_${newId()}`}, ${id})`;
  const { ensureDiagramsForWorkspace } = await import("./bpmn");
  await ensureDiagramsForWorkspace(id);
  const ws = await getWorkspaceById(id);
  if (!ws) throw new Error("workspace_create_failed");
  return { workspace: ws, existed: false };
}

/* --------------------- BD → DD handoff (Oct 24, 2026) -------------------- */

/**
 * Terminal stages never gain a workspace from the handoff (the close
 * cascade owns Closed; Passed deals stay out of Due Diligence).
 */
const HANDOFF_TERMINAL_STAGES: ReadonlySet<string> = new Set([
  "Passed",
  "Closed",
  "Closed Won",
]);

/**
 * Does `stage` put a deal of investment type `typeKey` in (or past)
 * diligence? Stage lists are per-type data (bd.type_config, read via
 * the bd service): the anchor is the stage named "Diligence"; any
 * later stage in the same list (LOI, Financing, …) also qualifies,
 * because the workspace — closing checklist included — is the deal's
 * working record from diligence entry through closing. A type whose
 * configured list has no "Diligence" stage never auto-creates.
 */
export async function stageEntersDiligence(
  stage: string,
  typeKey: string
): Promise<boolean> {
  if (!stage || HANDOFF_TERMINAL_STAGES.has(stage)) return false;
  const { stagesForType } = await import("../bd/service");
  const stages = await stagesForType(typeKey || "platform_lbo");
  const anchor = stages.indexOf("Diligence");
  if (anchor === -1) return false;
  return stages.indexOf(stage) >= anchor;
}

export interface DiligenceHandoffResult {
  created: boolean;
  existed: boolean;
  workspaceId: string | null;
  /** Why no workspace was created, when neither flag is set. */
  reason: "deal_not_found" | "stage_not_in_diligence" | "error" | null;
}

/**
 * The BD → Due Diligence handoff: if the deal currently sits in (or
 * past) a diligence stage for its investment type, make sure it has a
 * diligence workspace, creating and seeding it when missing.
 * Idempotent (createWorkspace is) and NEVER throws — the handoff runs
 * inside other modules' write paths and must not break them.
 *
 * Until Oct 24, 2026 nothing called this: `deal_stage_changed` was a
 * defined event type with no publisher and no handler, and workspaces
 * came only from the manual "Start diligence" action — so deals that
 * were seeded, imported, or moved into Diligence without that manual
 * step never appeared on the Due Diligence page (its hub summary lists
 * workspace-holders only). Wired from: the deal_stage_changed handler
 * below, the deals PUT/POST/import routes, and the one-time backfill
 * in lib/diligence/backfill.ts.
 */
export async function ensureWorkspaceForDeal(
  dealId: string,
  actor: string
): Promise<DiligenceHandoffResult> {
  const none = (
    reason: DiligenceHandoffResult["reason"]
  ): DiligenceHandoffResult => ({
    created: false,
    existed: false,
    workspaceId: null,
    reason,
  });
  try {
    await ensureDiligence();
    const db = sql();
    const rows = await db`
      SELECT stage, investment_type FROM deals WHERE id = ${dealId} LIMIT 1`;
    if (!rows.length) return none("deal_not_found");
    const rec = rows[0] as Record<string, unknown>;
    const stage = str(rec.stage);
    const typeKey = str(rec.investment_type) || "platform_lbo";
    if (!(await stageEntersDiligence(stage, typeKey))) {
      return none("stage_not_in_diligence");
    }
    // The core projection is normally kept fresh by the platform
    // backfill top-up (hourly); a deal that entered diligence seconds
    // ago may not be projected yet, and createWorkspace resolves the
    // deal through core.deals — upsert this deal's rows first.
    const { ensureCoreDealProjection } = await import("../platform/migrate");
    await ensureCoreDealProjection(db, dealId);
    const res = await createWorkspace(dealId, actor || "system");
    return {
      created: !res.existed,
      existed: res.existed,
      workspaceId: res.workspace.id,
      reason: null,
    };
  } catch (err) {
    console.error(
      "[diligence] workspace handoff failed for deal",
      dealId,
      err instanceof Error ? err.message : String(err)
    );
    return none("error");
  }
}

/**
 * deal_stage_changed → workspace handoff. Registered once per process
 * at module load, mirroring lib/monitoring/service.ts and
 * lib/capital/service.ts. The deals write paths also call
 * ensureWorkspaceForDeal directly (a cold process may not have this
 * module loaded when the event is published); both paths are
 * idempotent, so double-firing is harmless.
 */
let diligenceHandlersRegistered = false;
function registerDiligenceHandlers(): void {
  if (diligenceHandlersRegistered) return;
  diligenceHandlersRegistered = true;
  onEvent("deal_stage_changed", async (evt) => {
    const dealId =
      (typeof evt.payload?.dealId === "string" && evt.payload.dealId) ||
      evt.entityId;
    if (!dealId) return;
    await ensureWorkspaceForDeal(dealId, evt.actor || "system");
  });
}
registerDiligenceHandlers();

export async function updateWorkspace(
  id: string,
  input: { status?: string; notes?: string }
): Promise<WorkspaceRow> {
  const ws = await requireWorkspace(id);
  const db = sql();
  await db`
    UPDATE diligence.workspaces
    SET status = ${input.status !== undefined ? String(input.status) : ws.status},
        notes = ${input.notes !== undefined ? String(input.notes) : ws.notes},
        updated_at = now()
    WHERE id = ${id}`;
  return (await getWorkspaceById(id)) as WorkspaceRow;
}

export async function deleteWorkspace(id: string): Promise<boolean> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    UPDATE diligence.workspaces SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/** Index-page data: every core deal with its workspace + progress. */
export async function listDealWorkspaces(): Promise<
  Array<{
    deal: DealContext;
    workspace: WorkspaceRow | null;
    checklistTotal: number;
    checklistDone: number;
    openRedFlags: number;
    candidateRedFlags: number;
    roomId: string | null;
  }>
> {
  await ensureDiligence();
  const db = sql();
  const dealRows = await db`
    SELECT cd.id, cd.company_id, cd.stage,
      coalesce(ld.company_name, co.name, '') AS deal_name,
      coalesce(co.name, '') AS company_name,
      coalesce(ld.owner, '') AS deal_owner
    FROM core.deals cd
    LEFT JOIN deals ld ON ld.id = cd.id
    LEFT JOIN core.companies co ON co.id = cd.company_id
    ORDER BY cd.updated_at DESC`;
  const out: Array<{
    deal: DealContext;
    workspace: WorkspaceRow | null;
    checklistTotal: number;
    checklistDone: number;
    openRedFlags: number;
    candidateRedFlags: number;
    roomId: string | null;
  }> = [];
  const rooms = await listRooms({ limit: 50 }).catch(() => ({
    items: [] as Array<{ id: string; dealId: string }>,
    total: 0,
  }));
  for (const r of dealRows) {
    const rec = r as Record<string, unknown>;
    const deal: DealContext = {
      dealId: str(rec.id),
      companyId: rec.company_id ? str(rec.company_id) : null,
      dealName: str(rec.deal_name),
      companyName: str(rec.company_name),
      stage: str(rec.stage),
      owner: str(rec.deal_owner),
    };
    const ws = await getWorkspaceByDeal(deal.dealId);
    let checklistTotal = 0;
    let checklistDone = 0;
    let openRedFlags = 0;
    let candidateRedFlags = 0;
    if (ws) {
      const counts = await db`
        SELECT
          (SELECT count(*)::int FROM diligence.checklist_items
            WHERE workspace_id = ${ws.id} AND deleted_at IS NULL) AS total,
          (SELECT count(*)::int FROM diligence.checklist_items
            WHERE workspace_id = ${ws.id} AND deleted_at IS NULL
              AND status IN ('received','reviewed','approved','waived','na')) AS done,
          (SELECT count(*)::int FROM diligence.red_flags
            WHERE workspace_id = ${ws.id} AND deleted_at IS NULL
              AND status IN ('open','mitigating')) AS open_flags,
          (SELECT count(*)::int FROM diligence.red_flags
            WHERE workspace_id = ${ws.id} AND deleted_at IS NULL
              AND status = 'candidate') AS cand_flags`;
      const c = counts[0] as Record<string, unknown>;
      checklistTotal = num(c.total);
      checklistDone = num(c.done);
      openRedFlags = num(c.open_flags);
      candidateRedFlags = num(c.cand_flags);
    }
    const room = rooms.items.find((x) => x.dealId === deal.dealId);
    out.push({
      deal,
      workspace: ws,
      checklistTotal,
      checklistDone,
      openRedFlags,
      candidateRedFlags,
      roomId: room ? room.id : null,
    });
  }
  logUsage("diligence_deals_list", out.length, JSON.stringify(out).length);
  return out;
}

/** The data room for a deal, resolved through the dataroom service. */
export async function findRoomForDeal(
  dealId: string
): Promise<{ id: string; name: string } | null> {
  const rooms = await listRooms({ limit: 50 }).catch(() => null);
  if (!rooms) return null;
  const room = rooms.items.find((x) => x.dealId === dealId);
  return room ? { id: room.id, name: room.name } : null;
}

/* ------------------------------ checklist ------------------------------ */

export interface ChecklistItemRow {
  id: string;
  workspaceId: string;
  workstream: string;
  title: string;
  owner: string;
  status: string;
  dueDate: string | null;
  notes: string;
  dataroomChecklistItemId: string | null;
  dataroomDocumentId: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

function rowToChecklistItem(r: Record<string, unknown>): ChecklistItemRow {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    workstream: str(r.workstream) || "financial",
    title: str(r.title),
    owner: str(r.owner),
    status: str(r.status) || "not_started",
    dueDate: dateOrNull(r.due_date),
    notes: str(r.notes),
    dataroomChecklistItemId: r.dataroom_checklist_item_id
      ? str(r.dataroom_checklist_item_id)
      : null,
    dataroomDocumentId: r.dataroom_document_id
      ? str(r.dataroom_document_id)
      : null,
    sort: num(r.sort),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function listChecklistItems(
  workspaceId: string
): Promise<ChecklistItemRow[]> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.checklist_items
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    ORDER BY workstream ASC, sort ASC, created_at ASC`;
  return rows.map((r) => rowToChecklistItem(r as Record<string, unknown>));
}

export async function createChecklistItem(
  workspaceId: string,
  input: {
    workstream?: string;
    title: string;
    owner?: string;
    status?: string;
    dueDate?: string | null;
    notes?: string;
    dataroomChecklistItemId?: string | null;
    dataroomDocumentId?: string | null;
  },
  actor: string
): Promise<ChecklistItemRow> {
  await requireWorkspace(workspaceId);
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("title_required");
  const workstream = (WORKSTREAMS as readonly string[]).includes(
    input.workstream ?? ""
  )
    ? (input.workstream as string)
    : "financial";
  const status = (CHECKLIST_STATUSES as readonly string[]).includes(
    input.status ?? ""
  )
    ? (input.status as string)
    : "not_started";
  const db = sql();
  const maxRows = await db`
    SELECT coalesce(max(sort), 0)::int AS m FROM diligence.checklist_items
    WHERE workspace_id = ${workspaceId}`;
  const id = `dci_${newId()}`;
  await db`
    INSERT INTO diligence.checklist_items
      (id, workspace_id, workstream, title, owner, status, due_date, notes,
       dataroom_checklist_item_id, dataroom_document_id, sort, created_by)
    VALUES (${id}, ${workspaceId}, ${workstream}, ${title},
      ${(input.owner ?? "").trim()}, ${status},
      ${cleanDate(input.dueDate)}, ${(input.notes ?? "").trim()},
      ${input.dataroomChecklistItemId ?? null},
      ${input.dataroomDocumentId ?? null},
      ${num((maxRows[0] as Record<string, unknown>).m) + 10}, ${actor})`;
  const rows = await db`
    SELECT * FROM diligence.checklist_items WHERE id = ${id} LIMIT 1`;
  return rowToChecklistItem(rows[0] as Record<string, unknown>);
}

export async function updateChecklistItem(
  itemId: string,
  input: {
    workstream?: string;
    title?: string;
    owner?: string;
    status?: string;
    dueDate?: string | null;
    notes?: string;
    dataroomChecklistItemId?: string | null;
    dataroomDocumentId?: string | null;
  }
): Promise<ChecklistItemRow> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.checklist_items
    WHERE id = ${itemId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new Error("checklist_item_not_found");
  const cur = rowToChecklistItem(rows[0] as Record<string, unknown>);
  const next = {
    workstream:
      input.workstream !== undefined &&
      (WORKSTREAMS as readonly string[]).includes(input.workstream)
        ? input.workstream
        : cur.workstream,
    title: input.title !== undefined ? input.title.trim() : cur.title,
    owner: input.owner !== undefined ? input.owner.trim() : cur.owner,
    status:
      input.status !== undefined &&
      (CHECKLIST_STATUSES as readonly string[]).includes(input.status)
        ? input.status
        : cur.status,
    dueDate:
      input.dueDate !== undefined ? cleanDate(input.dueDate) : cur.dueDate,
    notes: input.notes !== undefined ? input.notes : cur.notes,
    dataroomChecklistItemId:
      input.dataroomChecklistItemId !== undefined
        ? input.dataroomChecklistItemId
        : cur.dataroomChecklistItemId,
    dataroomDocumentId:
      input.dataroomDocumentId !== undefined
        ? input.dataroomDocumentId
        : cur.dataroomDocumentId,
  };
  if (!next.title) throw new Error("title_required");
  await db`
    UPDATE diligence.checklist_items
    SET workstream = ${next.workstream}, title = ${next.title},
        owner = ${next.owner}, status = ${next.status},
        due_date = ${next.dueDate}, notes = ${next.notes},
        dataroom_checklist_item_id = ${next.dataroomChecklistItemId},
        dataroom_document_id = ${next.dataroomDocumentId},
        updated_at = now()
    WHERE id = ${itemId}`;
  const after = await db`
    SELECT * FROM diligence.checklist_items WHERE id = ${itemId} LIMIT 1`;
  return rowToChecklistItem(after[0] as Record<string, unknown>);
}

export async function deleteChecklistItem(itemId: string): Promise<boolean> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    UPDATE diligence.checklist_items SET deleted_at = now(), updated_at = now()
    WHERE id = ${itemId} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/* --------------------------- request list ------------------------------ */

export interface RequestItemRow {
  id: string;
  workspaceId: string;
  checklistItemId: string | null;
  dataroomChecklistItemId: string | null;
  label: string;
  status: string;
  lastRequestedAt: string | null;
  respondedAt: string | null;
  responseNotes: string;
  createdAt: string;
  updatedAt: string;
}

function rowToRequestItem(r: Record<string, unknown>): RequestItemRow {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    checklistItemId: r.checklist_item_id ? str(r.checklist_item_id) : null,
    dataroomChecklistItemId: r.dataroom_checklist_item_id
      ? str(r.dataroom_checklist_item_id)
      : null,
    label: str(r.label),
    status: str(r.status) || "requested",
    lastRequestedAt: isoOrNull(r.last_requested_at),
    respondedAt: isoOrNull(r.responded_at),
    responseNotes: str(r.response_notes),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function listRequestItems(
  workspaceId: string
): Promise<RequestItemRow[]> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.request_items
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    ORDER BY created_at ASC`;
  return rows.map((r) => rowToRequestItem(r as Record<string, unknown>));
}

/**
 * Generate / refresh the request list from data room status: every room
 * checklist item that is not satisfied (received / waived / na) becomes
 * a request. Items already tracked keep their response state; items the
 * room later marks satisfied flip to 'received' here automatically.
 * Satisfied = the Phase 3 completeness rule.
 */
export async function generateRequests(
  workspaceId: string
): Promise<{
  roomId: string | null;
  created: number;
  updated: number;
  items: RequestItemRow[];
  roomChecklist: RoomChecklistItem[];
}> {
  const ws = await requireWorkspace(workspaceId);
  const room = await findRoomForDeal(ws.dealId);
  if (!room) {
    return {
      roomId: null,
      created: 0,
      updated: 0,
      items: await listRequestItems(workspaceId),
      roomChecklist: [],
    };
  }
  const checklist = await getRoomChecklist(room.id);
  const db = sql();
  const existing = await listRequestItems(workspaceId);
  const byRoomItem = new Map(
    existing
      .filter((i) => i.dataroomChecklistItemId)
      .map((i) => [i.dataroomChecklistItemId as string, i])
  );
  let created = 0;
  let updated = 0;
  for (const item of checklist) {
    const satisfied = ["received", "waived", "na"].includes(item.status);
    const prior = byRoomItem.get(item.id);
    if (!prior) {
      if (satisfied) continue;
      const id = `rqi_${newId()}`;
      await db`
        INSERT INTO diligence.request_items
          (id, workspace_id, dataroom_checklist_item_id, label, status)
        VALUES (${id}, ${workspaceId}, ${item.id}, ${item.label}, 'requested')`;
      created += 1;
    } else if (satisfied && prior.status === "requested") {
      await db`
        UPDATE diligence.request_items
        SET status = 'received', responded_at = now(), updated_at = now()
        WHERE id = ${prior.id}`;
      updated += 1;
    } else if (!satisfied && prior.status === "received") {
      // Room item was un-received upstream — reopen the request.
      await db`
        UPDATE diligence.request_items
        SET status = 'requested', responded_at = NULL, updated_at = now()
        WHERE id = ${prior.id}`;
      updated += 1;
    }
  }
  return {
    roomId: room.id,
    created,
    updated,
    items: await listRequestItems(workspaceId),
    roomChecklist: checklist,
  };
}

export interface RequestSendRow {
  id: string;
  workspaceId: string;
  recipient: string;
  subject: string;
  body: string;
  channel: string;
  itemIds: string[];
  sentBy: string;
  createdAt: string;
}

export async function listRequestSends(
  workspaceId: string
): Promise<RequestSendRow[]> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.request_sends
    WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC LIMIT 50`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      id: str(rec.id),
      workspaceId: str(rec.workspace_id),
      recipient: str(rec.recipient),
      subject: str(rec.subject),
      body: str(rec.body),
      channel: str(rec.channel),
      itemIds: jsonArr<string>(rec.item_ids),
      sentBy: str(rec.sent_by),
      createdAt: isoOrNull(rec.created_at) ?? "",
    };
  });
}

/**
 * Compose the ONE clean request email for the outstanding items. When a
 * Phase 2 email template is chosen, its subject/body are used with
 * {{items}} / {{deal}} / {{company}} / {{count}} substitution; otherwise
 * a built-in format is produced. Sending is mailto-based (no Graph mail
 * scope yet): the caller gets a ready-to-send composition + mailto URL,
 * and logRequestSend() records it once the user sends it.
 */
export async function composeRequestEmail(
  workspaceId: string,
  input: { templateId?: string; recipient?: string }
): Promise<{
  subject: string;
  body: string;
  mailto: string;
  itemCount: number;
  templateName: string | null;
}> {
  const ws = await requireWorkspace(workspaceId);
  const ctx = await getDealContext(ws.dealId);
  const items = (await listRequestItems(workspaceId)).filter(
    (i) => i.status === "requested"
  );
  const dealName = ctx?.dealName || ctx?.companyName || "the target";
  const numbered = items.map((i, idx) => `${idx + 1}. ${i.label}`).join("\n");
  let subject = `Information request — ${dealName} diligence`;
  let body =
    `Hello,\n\nAs part of our due diligence on ${dealName}, please provide ` +
    `the following items (or upload them to the data room):\n\n${numbered}\n\n` +
    `Thank you,\nCanny Capital Partners`;
  let templateName: string | null = null;
  if (input.templateId) {
    const templates = await listTemplates(50);
    const tpl = templates.find((t) => t.id === input.templateId);
    if (tpl) {
      templateName = tpl.name;
      const fill = (s: string) =>
        s
          .replaceAll("{{items}}", numbered)
          .replaceAll("{{deal}}", dealName)
          .replaceAll("{{company}}", ctx?.companyName || dealName)
          .replaceAll("{{count}}", String(items.length));
      if (tpl.subject.trim()) subject = fill(tpl.subject);
      if (tpl.body.trim()) body = fill(tpl.body);
    }
  }
  const recipient = (input.recipient ?? "").trim();
  const mailto =
    `mailto:${encodeURIComponent(recipient)}` +
    `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { subject, body, mailto, itemCount: items.length, templateName };
}

export async function logRequestSend(
  workspaceId: string,
  input: {
    recipient?: string;
    subject: string;
    body: string;
    itemIds?: string[];
    channel?: string;
  },
  actor: string
): Promise<RequestSendRow> {
  await requireWorkspace(workspaceId);
  const db = sql();
  const id = `rqs_${newId()}`;
  const itemIds = input.itemIds ?? [];
  await db`
    INSERT INTO diligence.request_sends
      (id, workspace_id, recipient, subject, body, channel, item_ids, sent_by)
    VALUES (${id}, ${workspaceId}, ${(input.recipient ?? "").trim()},
      ${input.subject}, ${input.body}, ${input.channel ?? "mailto"},
      ${JSON.stringify(itemIds)}::jsonb, ${actor})`;
  for (const itemId of itemIds) {
    await db`
      UPDATE diligence.request_items
      SET last_requested_at = now(), updated_at = now()
      WHERE id = ${itemId} AND workspace_id = ${workspaceId}`;
  }
  const rows = await db`
    SELECT * FROM diligence.request_sends WHERE id = ${id} LIMIT 1`;
  const rec = rows[0] as Record<string, unknown>;
  return {
    id: str(rec.id),
    workspaceId: str(rec.workspace_id),
    recipient: str(rec.recipient),
    subject: str(rec.subject),
    body: str(rec.body),
    channel: str(rec.channel),
    itemIds: jsonArr<string>(rec.item_ids),
    sentBy: str(rec.sent_by),
    createdAt: isoOrNull(rec.created_at) ?? "",
  };
}

export async function updateRequestItem(
  itemId: string,
  input: { status?: string; responseNotes?: string }
): Promise<RequestItemRow> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.request_items
    WHERE id = ${itemId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new Error("request_item_not_found");
  const cur = rowToRequestItem(rows[0] as Record<string, unknown>);
  const status =
    input.status !== undefined &&
    ["requested", "received", "waived"].includes(input.status)
      ? input.status
      : cur.status;
  const respondedAt =
    status === "received" && cur.status !== "received"
      ? new Date().toISOString()
      : status === "requested"
        ? null
        : cur.respondedAt;
  await db`
    UPDATE diligence.request_items
    SET status = ${status},
        response_notes = ${input.responseNotes !== undefined ? input.responseNotes : cur.responseNotes},
        responded_at = ${respondedAt}, updated_at = now()
    WHERE id = ${itemId}`;
  const after = await db`
    SELECT * FROM diligence.request_items WHERE id = ${itemId} LIMIT 1`;
  return rowToRequestItem(after[0] as Record<string, unknown>);
}

/* ------------------------- findings → deal terms ------------------------ */

export interface FindingRow {
  id: string;
  workspaceId: string;
  title: string;
  detail: string;
  category: string;
  severity: string;
  proposedTermType: string;
  proposedTermDetail: string;
  status: string;
  redFlagId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToFinding(r: Record<string, unknown>): FindingRow {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    title: str(r.title),
    detail: str(r.detail),
    category: str(r.category),
    severity: str(r.severity) || "medium",
    proposedTermType: str(r.proposed_term_type) || "other",
    proposedTermDetail: str(r.proposed_term_detail),
    status: str(r.status) || "proposed",
    redFlagId: r.red_flag_id ? str(r.red_flag_id) : null,
    decidedBy: r.decided_by ? str(r.decided_by) : null,
    decidedAt: isoOrNull(r.decided_at),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function listFindings(
  workspaceId: string
): Promise<FindingRow[]> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.findings
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    ORDER BY created_at DESC`;
  return rows.map((r) => rowToFinding(r as Record<string, unknown>));
}

export async function createFinding(
  workspaceId: string,
  input: {
    title: string;
    detail?: string;
    category?: string;
    severity?: string;
    proposedTermType?: string;
    proposedTermDetail?: string;
    redFlagId?: string | null;
  },
  actor: string
): Promise<FindingRow> {
  await requireWorkspace(workspaceId);
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("title_required");
  const db = sql();
  const id = `fnd_${newId()}`;
  await db`
    INSERT INTO diligence.findings
      (id, workspace_id, title, detail, category, severity,
       proposed_term_type, proposed_term_detail, red_flag_id, created_by)
    VALUES (${id}, ${workspaceId}, ${title}, ${(input.detail ?? "").trim()},
      ${(input.category ?? "").trim()},
      ${["high", "medium", "low"].includes(input.severity ?? "") ? input.severity : "medium"},
      ${input.proposedTermType ?? "other"},
      ${(input.proposedTermDetail ?? "").trim()},
      ${input.redFlagId ?? null}, ${actor})`;
  const rows = await db`
    SELECT * FROM diligence.findings WHERE id = ${id} LIMIT 1`;
  return rowToFinding(rows[0] as Record<string, unknown>);
}

export async function updateFinding(
  findingId: string,
  input: {
    title?: string;
    detail?: string;
    category?: string;
    severity?: string;
    proposedTermType?: string;
    proposedTermDetail?: string;
    status?: string;
  },
  actor: string
): Promise<FindingRow> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.findings
    WHERE id = ${findingId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new Error("finding_not_found");
  const cur = rowToFinding(rows[0] as Record<string, unknown>);
  const status =
    input.status !== undefined &&
    (FINDING_STATUSES as readonly string[]).includes(input.status)
      ? input.status
      : cur.status;
  const decided = status !== cur.status && status !== "proposed";
  await db`
    UPDATE diligence.findings
    SET title = ${input.title !== undefined ? input.title.trim() : cur.title},
        detail = ${input.detail !== undefined ? input.detail : cur.detail},
        category = ${input.category !== undefined ? input.category : cur.category},
        severity = ${input.severity !== undefined && ["high", "medium", "low"].includes(input.severity) ? input.severity : cur.severity},
        proposed_term_type = ${input.proposedTermType !== undefined ? input.proposedTermType : cur.proposedTermType},
        proposed_term_detail = ${input.proposedTermDetail !== undefined ? input.proposedTermDetail : cur.proposedTermDetail},
        status = ${status},
        decided_by = ${decided ? actor : cur.decidedBy},
        decided_at = ${decided ? new Date().toISOString() : cur.decidedAt},
        updated_at = now()
    WHERE id = ${findingId}`;
  const after = await db`
    SELECT * FROM diligence.findings WHERE id = ${findingId} LIMIT 1`;
  return rowToFinding(after[0] as Record<string, unknown>);
}

export async function deleteFinding(findingId: string): Promise<boolean> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    UPDATE diligence.findings SET deleted_at = now(), updated_at = now()
    WHERE id = ${findingId} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/* ---------------------------- contract register ------------------------ */

export interface ContractRow {
  id: string;
  workspaceId: string;
  counterparty: string;
  contractType: string;
  title: string;
  effectiveDate: string | null;
  expiryDate: string | null;
  renewalDate: string | null;
  autoRenew: boolean;
  changeOfControl: string;
  terminationTerms: string;
  keyTerms: string;
  annualValue: number | null;
  documentId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

function rowToContract(r: Record<string, unknown>): ContractRow {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    counterparty: str(r.counterparty),
    contractType: str(r.contract_type),
    title: str(r.title),
    effectiveDate: dateOrNull(r.effective_date),
    expiryDate: dateOrNull(r.expiry_date),
    renewalDate: dateOrNull(r.renewal_date),
    autoRenew: Boolean(r.auto_renew),
    changeOfControl: str(r.change_of_control),
    terminationTerms: str(r.termination_terms),
    keyTerms: str(r.key_terms),
    annualValue: numOrNull(r.annual_value),
    documentId: r.document_id ? str(r.document_id) : null,
    notes: str(r.notes),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function listContracts(
  workspaceId: string
): Promise<ContractRow[]> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.contracts
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    ORDER BY expiry_date ASC NULLS LAST, created_at ASC`;
  return rows.map((r) => rowToContract(r as Record<string, unknown>));
}

export interface ContractInput {
  counterparty?: string;
  contractType?: string;
  title?: string;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  renewalDate?: string | null;
  autoRenew?: boolean;
  changeOfControl?: string;
  terminationTerms?: string;
  keyTerms?: string;
  annualValue?: number | null;
  documentId?: string | null;
  notes?: string;
}

export async function createContract(
  workspaceId: string,
  input: ContractInput
): Promise<ContractRow> {
  await requireWorkspace(workspaceId);
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("title_required");
  const db = sql();
  const id = `con_${newId()}`;
  await db`
    INSERT INTO diligence.contracts
      (id, workspace_id, counterparty, contract_type, title, effective_date,
       expiry_date, renewal_date, auto_renew, change_of_control,
       termination_terms, key_terms, annual_value, document_id, notes)
    VALUES (${id}, ${workspaceId}, ${(input.counterparty ?? "").trim()},
      ${(input.contractType ?? "").trim()}, ${title},
      ${cleanDate(input.effectiveDate)}, ${cleanDate(input.expiryDate)},
      ${cleanDate(input.renewalDate)}, ${Boolean(input.autoRenew)},
      ${input.changeOfControl ?? ""}, ${input.terminationTerms ?? ""},
      ${input.keyTerms ?? ""}, ${input.annualValue ?? null},
      ${input.documentId ?? null}, ${input.notes ?? ""})`;
  const rows = await db`
    SELECT * FROM diligence.contracts WHERE id = ${id} LIMIT 1`;
  return rowToContract(rows[0] as Record<string, unknown>);
}

export async function updateContract(
  contractId: string,
  input: ContractInput
): Promise<ContractRow> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.contracts
    WHERE id = ${contractId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new Error("contract_not_found");
  const cur = rowToContract(rows[0] as Record<string, unknown>);
  await db`
    UPDATE diligence.contracts
    SET counterparty = ${input.counterparty !== undefined ? input.counterparty : cur.counterparty},
        contract_type = ${input.contractType !== undefined ? input.contractType : cur.contractType},
        title = ${input.title !== undefined ? input.title.trim() : cur.title},
        effective_date = ${input.effectiveDate !== undefined ? cleanDate(input.effectiveDate) : cur.effectiveDate},
        expiry_date = ${input.expiryDate !== undefined ? cleanDate(input.expiryDate) : cur.expiryDate},
        renewal_date = ${input.renewalDate !== undefined ? cleanDate(input.renewalDate) : cur.renewalDate},
        auto_renew = ${input.autoRenew !== undefined ? Boolean(input.autoRenew) : cur.autoRenew},
        change_of_control = ${input.changeOfControl !== undefined ? input.changeOfControl : cur.changeOfControl},
        termination_terms = ${input.terminationTerms !== undefined ? input.terminationTerms : cur.terminationTerms},
        key_terms = ${input.keyTerms !== undefined ? input.keyTerms : cur.keyTerms},
        annual_value = ${input.annualValue !== undefined ? input.annualValue : cur.annualValue},
        document_id = ${input.documentId !== undefined ? input.documentId : cur.documentId},
        notes = ${input.notes !== undefined ? input.notes : cur.notes},
        updated_at = now()
    WHERE id = ${contractId}`;
  const after = await db`
    SELECT * FROM diligence.contracts WHERE id = ${contractId} LIMIT 1`;
  return rowToContract(after[0] as Record<string, unknown>);
}

export async function deleteContract(contractId: string): Promise<boolean> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    UPDATE diligence.contracts SET deleted_at = now(), updated_at = now()
    WHERE id = ${contractId} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/* ----------------------------- licenses -------------------------------- */

export interface LicenseRow {
  id: string;
  workspaceId: string;
  licenseType: string;
  issuingBody: string;
  licenseNumber: string;
  issuedDate: string | null;
  expiryDate: string | null;
  transferability: string;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

function rowToLicense(r: Record<string, unknown>): LicenseRow {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    licenseType: str(r.license_type),
    issuingBody: str(r.issuing_body),
    licenseNumber: str(r.license_number),
    issuedDate: dateOrNull(r.issued_date),
    expiryDate: dateOrNull(r.expiry_date),
    transferability: str(r.transferability) || "unknown",
    status: str(r.status) || "active",
    notes: str(r.notes),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function listLicenses(
  workspaceId: string
): Promise<LicenseRow[]> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.licenses
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    ORDER BY expiry_date ASC NULLS LAST, created_at ASC`;
  return rows.map((r) => rowToLicense(r as Record<string, unknown>));
}

export interface LicenseInput {
  licenseType?: string;
  issuingBody?: string;
  licenseNumber?: string;
  issuedDate?: string | null;
  expiryDate?: string | null;
  transferability?: string;
  status?: string;
  notes?: string;
}

function validTransferability(v: string | undefined): string {
  return (LICENSE_TRANSFERABILITY as readonly string[]).includes(v ?? "")
    ? (v as string)
    : "unknown";
}

export async function createLicense(
  workspaceId: string,
  input: LicenseInput
): Promise<LicenseRow> {
  await requireWorkspace(workspaceId);
  const licenseType = (input.licenseType ?? "").trim();
  if (!licenseType) throw new Error("license_type_required");
  const db = sql();
  const id = `lic_${newId()}`;
  await db`
    INSERT INTO diligence.licenses
      (id, workspace_id, license_type, issuing_body, license_number,
       issued_date, expiry_date, transferability, status, notes)
    VALUES (${id}, ${workspaceId}, ${licenseType},
      ${(input.issuingBody ?? "").trim()}, ${(input.licenseNumber ?? "").trim()},
      ${cleanDate(input.issuedDate)}, ${cleanDate(input.expiryDate)},
      ${validTransferability(input.transferability)},
      ${(input.status ?? "active").trim() || "active"}, ${input.notes ?? ""})`;
  const rows = await db`
    SELECT * FROM diligence.licenses WHERE id = ${id} LIMIT 1`;
  return rowToLicense(rows[0] as Record<string, unknown>);
}

export async function updateLicense(
  licenseId: string,
  input: LicenseInput
): Promise<LicenseRow> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.licenses
    WHERE id = ${licenseId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new Error("license_not_found");
  const cur = rowToLicense(rows[0] as Record<string, unknown>);
  await db`
    UPDATE diligence.licenses
    SET license_type = ${input.licenseType !== undefined ? input.licenseType.trim() : cur.licenseType},
        issuing_body = ${input.issuingBody !== undefined ? input.issuingBody : cur.issuingBody},
        license_number = ${input.licenseNumber !== undefined ? input.licenseNumber : cur.licenseNumber},
        issued_date = ${input.issuedDate !== undefined ? cleanDate(input.issuedDate) : cur.issuedDate},
        expiry_date = ${input.expiryDate !== undefined ? cleanDate(input.expiryDate) : cur.expiryDate},
        transferability = ${input.transferability !== undefined ? validTransferability(input.transferability) : cur.transferability},
        status = ${input.status !== undefined ? input.status : cur.status},
        notes = ${input.notes !== undefined ? input.notes : cur.notes},
        updated_at = now()
    WHERE id = ${licenseId}`;
  const after = await db`
    SELECT * FROM diligence.licenses WHERE id = ${licenseId} LIMIT 1`;
  return rowToLicense(after[0] as Record<string, unknown>);
}

export async function deleteLicense(licenseId: string): Promise<boolean> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    UPDATE diligence.licenses SET deleted_at = now(), updated_at = now()
    WHERE id = ${licenseId} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/* -------------------------------- tax ---------------------------------- */

export interface TaxProfileRow {
  id: string;
  workspaceId: string;
  entityType: string;
  elections: string[];
  nexusStates: string[];
  salesTaxExposure: string;
  nolAmount: number | null;
  nolNotes: string;
  credits: string;
  rdCredits: string;
  section338: Record<string, boolean>;
  missingReturnYears: number[];
  notes: string;
  updatedAt: string;
}

function rowToTaxProfile(r: Record<string, unknown>): TaxProfileRow {
  const s338raw = jsonObj(r.section_338);
  const s338: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(s338raw)) s338[k] = Boolean(v);
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    entityType: str(r.entity_type),
    elections: jsonArr<string>(r.elections),
    nexusStates: jsonArr<string>(r.nexus_states),
    salesTaxExposure: str(r.sales_tax_exposure),
    nolAmount: numOrNull(r.nol_amount),
    nolNotes: str(r.nol_notes),
    credits: str(r.credits),
    rdCredits: str(r.rd_credits),
    section338: s338,
    missingReturnYears: jsonArr<number>(r.missing_return_years),
    notes: str(r.notes),
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

/**
 * Which of the last three completed tax years have NO return evidence
 * in the deal's data room. Evidence = a document in the room's Tax
 * folder, or a satisfied room checklist item in that folder, whose name
 * / label mentions the year. Consumed via the dataroom service only.
 */
export async function computeMissingReturnYears(
  dealId: string
): Promise<{ missing: number[]; found: number[]; roomId: string | null }> {
  const room = await findRoomForDeal(dealId);
  if (!room) return { missing: [], found: [], roomId: null };
  const [index, folders, checklist] = await Promise.all([
    getRoomIndex(room.id).catch(() => null),
    listFolders(room.id).catch(() => []),
    getRoomChecklist(room.id).catch(() => []),
  ]);
  const taxFolderIds = new Set(
    folders.filter((f) => /tax/i.test(f.name)).map((f) => f.id)
  );
  const evidence: string[] = [];
  if (index) {
    for (const group of index.folders) {
      if (!taxFolderIds.has(group.folder.id)) continue;
      for (const doc of group.documents) evidence.push(doc.name);
    }
  }
  for (const item of checklist) {
    if (item.folderId && taxFolderIds.has(item.folderId)) {
      evidence.push(item.label);
      if (item.status === "received" && item.documentId) {
        // A received tax item without a year in its label still counts
        // as evidence for the years named in sibling labels only; the
        // label itself is the evidence carrier.
      }
    }
  }
  const foundYears = new Set<number>();
  for (const text of evidence) {
    for (const m of Array.from(text.matchAll(/\b(20\d{2})\b/g))) {
      foundYears.add(Number(m[1]));
    }
  }
  const nowYear = new Date().getUTCFullYear();
  const expected = [nowYear - 1, nowYear - 2, nowYear - 3];
  const missing = expected.filter((y) => !foundYears.has(y));
  return {
    missing,
    found: expected.filter((y) => foundYears.has(y)),
    roomId: room.id,
  };
}

export async function getTaxProfile(
  workspaceId: string
): Promise<{ profile: TaxProfileRow; missingYearsLive: number[]; roomId: string | null }> {
  const ws = await requireWorkspace(workspaceId);
  const db = sql();
  let rows = await db`
    SELECT * FROM diligence.tax_profiles
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) {
    await db`
      INSERT INTO diligence.tax_profiles (id, workspace_id)
      VALUES (${`tax_${newId()}`}, ${workspaceId})`;
    rows = await db`
      SELECT * FROM diligence.tax_profiles
      WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL LIMIT 1`;
  }
  const profile = rowToTaxProfile(rows[0] as Record<string, unknown>);
  const live = await computeMissingReturnYears(ws.dealId);
  // Persist the freshest missing-years verdict so the workspace summary
  // and any later reader see the same flag without recomputing.
  if (JSON.stringify(live.missing) !== JSON.stringify(profile.missingReturnYears)) {
    await db`
      UPDATE diligence.tax_profiles
      SET missing_return_years = ${JSON.stringify(live.missing)}::jsonb,
          updated_at = now()
      WHERE id = ${profile.id}`;
    profile.missingReturnYears = live.missing;
  }
  return { profile, missingYearsLive: live.missing, roomId: live.roomId };
}

export async function updateTaxProfile(
  workspaceId: string,
  input: Partial<{
    entityType: string;
    elections: string[];
    nexusStates: string[];
    salesTaxExposure: string;
    nolAmount: number | null;
    nolNotes: string;
    credits: string;
    rdCredits: string;
    section338: Record<string, boolean>;
    notes: string;
  }>
): Promise<TaxProfileRow> {
  const { profile } = await getTaxProfile(workspaceId);
  const db = sql();
  await db`
    UPDATE diligence.tax_profiles
    SET entity_type = ${input.entityType !== undefined ? input.entityType : profile.entityType},
        elections = ${JSON.stringify(input.elections !== undefined ? input.elections : profile.elections)}::jsonb,
        nexus_states = ${JSON.stringify(input.nexusStates !== undefined ? input.nexusStates : profile.nexusStates)}::jsonb,
        sales_tax_exposure = ${input.salesTaxExposure !== undefined ? input.salesTaxExposure : profile.salesTaxExposure},
        nol_amount = ${input.nolAmount !== undefined ? input.nolAmount : profile.nolAmount},
        nol_notes = ${input.nolNotes !== undefined ? input.nolNotes : profile.nolNotes},
        credits = ${input.credits !== undefined ? input.credits : profile.credits},
        rd_credits = ${input.rdCredits !== undefined ? input.rdCredits : profile.rdCredits},
        section_338 = ${JSON.stringify(input.section338 !== undefined ? input.section338 : profile.section338)}::jsonb,
        notes = ${input.notes !== undefined ? input.notes : profile.notes},
        updated_at = now()
    WHERE id = ${profile.id}`;
  const rows = await db`
    SELECT * FROM diligence.tax_profiles WHERE id = ${profile.id} LIMIT 1`;
  return rowToTaxProfile(rows[0] as Record<string, unknown>);
}

/* ------------------------------ scorecard ------------------------------ */

export interface ScorecardRow {
  id: string;
  workspaceId: string;
  areas: Record<string, { score: number | null; notes: string }>;
  notes: string;
  updatedAt: string;
}

function rowToScorecard(r: Record<string, unknown>): ScorecardRow {
  const raw = jsonObj(r.areas);
  const areas: Record<string, { score: number | null; notes: string }> = {};
  for (const [k, v] of Object.entries(raw)) {
    const rec = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    areas[k] = {
      score: typeof rec.score === "number" ? rec.score : null,
      notes: typeof rec.notes === "string" ? rec.notes : "",
    };
  }
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    areas,
    notes: str(r.notes),
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function getScorecard(
  workspaceId: string
): Promise<ScorecardRow> {
  await requireWorkspace(workspaceId);
  const db = sql();
  let rows = await db`
    SELECT * FROM diligence.scorecards
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) {
    await db`
      INSERT INTO diligence.scorecards (id, workspace_id)
      VALUES (${`sco_${newId()}`}, ${workspaceId})`;
    rows = await db`
      SELECT * FROM diligence.scorecards
      WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL LIMIT 1`;
  }
  return rowToScorecard(rows[0] as Record<string, unknown>);
}

export async function updateScorecard(
  workspaceId: string,
  input: {
    areas?: Record<string, { score: number | null; notes: string }>;
    notes?: string;
  }
): Promise<ScorecardRow> {
  const cur = await getScorecard(workspaceId);
  const db = sql();
  const areas =
    input.areas !== undefined
      ? Object.fromEntries(
          Object.entries(input.areas).map(([k, v]) => [
            k,
            {
              score:
                typeof v?.score === "number"
                  ? Math.min(5, Math.max(1, Math.round(v.score)))
                  : null,
              notes: typeof v?.notes === "string" ? v.notes : "",
            },
          ])
        )
      : cur.areas;
  await db`
    UPDATE diligence.scorecards
    SET areas = ${JSON.stringify(areas)}::jsonb,
        notes = ${input.notes !== undefined ? input.notes : cur.notes},
        updated_at = now()
    WHERE id = ${cur.id}`;
  return getScorecard(workspaceId);
}

/* ----------------------------- site visits ----------------------------- */

export interface SiteVisitRow {
  id: string;
  workspaceId: string;
  visitDate: string | null;
  attendees: string[];
  observations: string;
  photoDocumentIds: string[];
  facilityConditionScore: number | null;
  capacityNotes: string;
  utilizationEstimate: string;
  createdAt: string;
  updatedAt: string;
}

function rowToSiteVisit(r: Record<string, unknown>): SiteVisitRow {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    visitDate: dateOrNull(r.visit_date),
    attendees: jsonArr<string>(r.attendees),
    observations: str(r.observations),
    photoDocumentIds: jsonArr<string>(r.photo_document_ids),
    facilityConditionScore:
      r.facility_condition_score == null
        ? null
        : num(r.facility_condition_score),
    capacityNotes: str(r.capacity_notes),
    utilizationEstimate: str(r.utilization_estimate),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function listSiteVisits(
  workspaceId: string
): Promise<SiteVisitRow[]> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.site_visits
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    ORDER BY visit_date DESC NULLS LAST, created_at DESC`;
  return rows.map((r) => rowToSiteVisit(r as Record<string, unknown>));
}

export interface SiteVisitInput {
  visitDate?: string | null;
  attendees?: string[];
  observations?: string;
  photoDocumentIds?: string[];
  facilityConditionScore?: number | null;
  capacityNotes?: string;
  utilizationEstimate?: string;
}

export async function createSiteVisit(
  workspaceId: string,
  input: SiteVisitInput,
  actor: string
): Promise<SiteVisitRow> {
  await requireWorkspace(workspaceId);
  const db = sql();
  const id = `vis_${newId()}`;
  const score =
    typeof input.facilityConditionScore === "number"
      ? Math.min(5, Math.max(1, Math.round(input.facilityConditionScore)))
      : null;
  await db`
    INSERT INTO diligence.site_visits
      (id, workspace_id, visit_date, attendees, observations,
       photo_document_ids, facility_condition_score, capacity_notes,
       utilization_estimate, created_by)
    VALUES (${id}, ${workspaceId}, ${cleanDate(input.visitDate)},
      ${JSON.stringify(input.attendees ?? [])}::jsonb,
      ${input.observations ?? ""},
      ${JSON.stringify(input.photoDocumentIds ?? [])}::jsonb,
      ${score}, ${input.capacityNotes ?? ""},
      ${input.utilizationEstimate ?? ""}, ${actor})`;
  const rows = await db`
    SELECT * FROM diligence.site_visits WHERE id = ${id} LIMIT 1`;
  return rowToSiteVisit(rows[0] as Record<string, unknown>);
}

export async function updateSiteVisit(
  visitId: string,
  input: SiteVisitInput
): Promise<SiteVisitRow> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.site_visits
    WHERE id = ${visitId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new Error("site_visit_not_found");
  const cur = rowToSiteVisit(rows[0] as Record<string, unknown>);
  const score =
    input.facilityConditionScore !== undefined
      ? typeof input.facilityConditionScore === "number"
        ? Math.min(5, Math.max(1, Math.round(input.facilityConditionScore)))
        : null
      : cur.facilityConditionScore;
  await db`
    UPDATE diligence.site_visits
    SET visit_date = ${input.visitDate !== undefined ? cleanDate(input.visitDate) : cur.visitDate},
        attendees = ${JSON.stringify(input.attendees !== undefined ? input.attendees : cur.attendees)}::jsonb,
        observations = ${input.observations !== undefined ? input.observations : cur.observations},
        photo_document_ids = ${JSON.stringify(input.photoDocumentIds !== undefined ? input.photoDocumentIds : cur.photoDocumentIds)}::jsonb,
        facility_condition_score = ${score},
        capacity_notes = ${input.capacityNotes !== undefined ? input.capacityNotes : cur.capacityNotes},
        utilization_estimate = ${input.utilizationEstimate !== undefined ? input.utilizationEstimate : cur.utilizationEstimate},
        updated_at = now()
    WHERE id = ${visitId}`;
  const after = await db`
    SELECT * FROM diligence.site_visits WHERE id = ${visitId} LIMIT 1`;
  return rowToSiteVisit(after[0] as Record<string, unknown>);
}

export async function deleteSiteVisit(visitId: string): Promise<boolean> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    UPDATE diligence.site_visits SET deleted_at = now(), updated_at = now()
    WHERE id = ${visitId} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/* ------------------------------ red flags ------------------------------ */

export interface RedFlagRow {
  id: string;
  workspaceId: string;
  title: string;
  detail: string;
  severity: string;
  owner: string;
  mitigation: string;
  status: string;
  source: string;
  analysisId: string | null;
  anomalyRule: string | null;
  sourceSetId: string | null;
  periodEnd: string | null;
  confirmedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToRedFlag(r: Record<string, unknown>): RedFlagRow {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    title: str(r.title),
    detail: str(r.detail),
    severity: str(r.severity) || "medium",
    owner: str(r.owner),
    mitigation: str(r.mitigation),
    status: str(r.status) || "open",
    source: str(r.source) || "manual",
    analysisId: r.analysis_id ? str(r.analysis_id) : null,
    anomalyRule: r.anomaly_rule ? str(r.anomaly_rule) : null,
    sourceSetId: r.source_set_id ? str(r.source_set_id) : null,
    periodEnd: dateOrNull(r.period_end),
    confirmedBy: r.confirmed_by ? str(r.confirmed_by) : null,
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function listRedFlags(
  workspaceId: string
): Promise<RedFlagRow[]> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.red_flags
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    ORDER BY (status = 'candidate') DESC, created_at DESC`;
  return rows.map((r) => rowToRedFlag(r as Record<string, unknown>));
}

/**
 * AUTO-FEED from Part 4B: pull the company's current analysis (draft or
 * approved) through the finanalysis service and surface each anomaly as
 * a CANDIDATE red flag. Candidates are never auto-confirmed — a reviewer
 * confirms (→ open) or dismisses each one. Dedupe key:
 * analysisId : rule : periodEnd : setId, so re-syncs and re-runs of the
 * same analysis never duplicate; a NEW analysis's anomalies arrive as
 * fresh candidates attributed to that analysis.
 */
export async function syncRedFlagCandidates(
  workspaceId: string
): Promise<{
  analysisId: string | null;
  analysisStatus: string | null;
  created: number;
  totalCandidates: number;
}> {
  const ws = await requireWorkspace(workspaceId);
  if (!ws.companyId) {
    return { analysisId: null, analysisStatus: null, created: 0, totalCandidates: 0 };
  }
  const current = await getCurrentAnalysis(ws.companyId).catch(() => null);
  if (!current) {
    const flags = await listRedFlags(workspaceId);
    return {
      analysisId: null,
      analysisStatus: null,
      created: 0,
      totalCandidates: flags.filter((f) => f.status === "candidate").length,
    };
  }
  const { analysis, payload } = current;
  const db = sql();
  let created = 0;
  for (const anomaly of payload.anomalies ?? []) {
    const key = `${analysis.id}:${anomaly.rule}:${anomaly.periodEnd ?? ""}:${anomaly.setId ?? ""}`;
    const title =
      `Analysis anomaly — ${anomaly.rule.replaceAll("_", " ")}` +
      (anomaly.periodEnd ? ` (${anomaly.periodEnd})` : "");
    const detail =
      `${anomaly.message} [Source: financial analysis ${analysis.id} ` +
      `(status ${analysis.status}), rule ${anomaly.rule}` +
      (anomaly.periodEnd ? `, period ending ${anomaly.periodEnd}` : "") +
      ` — candidate for reviewer confirmation.]`;
    const rows = await db`
      INSERT INTO diligence.red_flags
        (id, workspace_id, title, detail, severity, status, source,
         analysis_id, anomaly_key, anomaly_rule, source_set_id, period_end)
      VALUES (${`flg_${newId()}`}, ${workspaceId}, ${title}, ${detail},
        ${anomaly.severity}, 'candidate', 'analysis', ${analysis.id},
        ${key}, ${anomaly.rule}, ${anomaly.setId},
        ${anomaly.periodEnd})
      ON CONFLICT (workspace_id, anomaly_key)
        WHERE deleted_at IS NULL AND anomaly_key IS NOT NULL
        DO NOTHING
      RETURNING id`;
    if (rows.length) created += 1;
  }
  const flags = await listRedFlags(workspaceId);
  return {
    analysisId: analysis.id,
    analysisStatus: analysis.status,
    created,
    totalCandidates: flags.filter((f) => f.status === "candidate").length,
  };
}

export async function createRedFlag(
  workspaceId: string,
  input: {
    title: string;
    detail?: string;
    severity?: string;
    owner?: string;
    mitigation?: string;
  }
): Promise<RedFlagRow> {
  await requireWorkspace(workspaceId);
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("title_required");
  const db = sql();
  const id = `flg_${newId()}`;
  await db`
    INSERT INTO diligence.red_flags
      (id, workspace_id, title, detail, severity, owner, mitigation, status, source)
    VALUES (${id}, ${workspaceId}, ${title}, ${(input.detail ?? "").trim()},
      ${["high", "medium", "low"].includes(input.severity ?? "") ? input.severity : "medium"},
      ${(input.owner ?? "").trim()}, ${(input.mitigation ?? "").trim()},
      'open', 'manual')`;
  const rows = await db`
    SELECT * FROM diligence.red_flags WHERE id = ${id} LIMIT 1`;
  return rowToRedFlag(rows[0] as Record<string, unknown>);
}

export async function updateRedFlag(
  flagId: string,
  input: {
    title?: string;
    detail?: string;
    severity?: string;
    owner?: string;
    mitigation?: string;
    status?: string;
  },
  actor: string
): Promise<RedFlagRow> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.red_flags
    WHERE id = ${flagId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new Error("red_flag_not_found");
  const cur = rowToRedFlag(rows[0] as Record<string, unknown>);
  const status =
    input.status !== undefined &&
    (RED_FLAG_STATUSES as readonly string[]).includes(input.status)
      ? input.status
      : cur.status;
  // Confirming a candidate = a reviewer moves it to 'open' (or any
  // non-candidate status); stamp who confirmed it.
  const confirming = cur.status === "candidate" && status !== "candidate";
  await db`
    UPDATE diligence.red_flags
    SET title = ${input.title !== undefined ? input.title.trim() : cur.title},
        detail = ${input.detail !== undefined ? input.detail : cur.detail},
        severity = ${input.severity !== undefined && ["high", "medium", "low"].includes(input.severity) ? input.severity : cur.severity},
        owner = ${input.owner !== undefined ? input.owner : cur.owner},
        mitigation = ${input.mitigation !== undefined ? input.mitigation : cur.mitigation},
        status = ${status},
        confirmed_by = ${confirming ? actor : cur.confirmedBy},
        updated_at = now()
    WHERE id = ${flagId}`;
  const after = await db`
    SELECT * FROM diligence.red_flags WHERE id = ${flagId} LIMIT 1`;
  return rowToRedFlag(after[0] as Record<string, unknown>);
}

export async function deleteRedFlag(flagId: string): Promise<boolean> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    UPDATE diligence.red_flags SET deleted_at = now(), updated_at = now()
    WHERE id = ${flagId} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/* --------------------------- closing checklist -------------------------- */

export interface ClosingItemRow {
  id: string;
  workspaceId: string;
  category: string;
  title: string;
  status: string;
  dueDate: string | null;
  completedAt: string | null;
  notes: string;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

function rowToClosingItem(r: Record<string, unknown>): ClosingItemRow {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    category: str(r.category) || "other",
    title: str(r.title),
    status: str(r.status) || "open",
    dueDate: dateOrNull(r.due_date),
    completedAt: isoOrNull(r.completed_at),
    notes: str(r.notes),
    sort: num(r.sort),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function listClosingItems(
  workspaceId: string
): Promise<ClosingItemRow[]> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.closing_items
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
    ORDER BY category ASC, sort ASC, created_at ASC`;
  return rows.map((r) => rowToClosingItem(r as Record<string, unknown>));
}

export interface ClosingItemInput {
  category?: string;
  title?: string;
  status?: string;
  dueDate?: string | null;
  notes?: string;
}

export async function createClosingItem(
  workspaceId: string,
  input: ClosingItemInput
): Promise<ClosingItemRow> {
  await requireWorkspace(workspaceId);
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("title_required");
  const category = (CLOSING_CATEGORIES as readonly string[]).includes(
    input.category ?? ""
  )
    ? (input.category as string)
    : "other";
  const db = sql();
  const maxRows = await db`
    SELECT coalesce(max(sort), 0)::int AS m FROM diligence.closing_items
    WHERE workspace_id = ${workspaceId}`;
  const id = `clo_${newId()}`;
  await db`
    INSERT INTO diligence.closing_items
      (id, workspace_id, category, title, status, due_date, notes, sort)
    VALUES (${id}, ${workspaceId}, ${category}, ${title}, 'open',
      ${cleanDate(input.dueDate)}, ${input.notes ?? ""},
      ${num((maxRows[0] as Record<string, unknown>).m) + 10})`;
  const rows = await db`
    SELECT * FROM diligence.closing_items WHERE id = ${id} LIMIT 1`;
  return rowToClosingItem(rows[0] as Record<string, unknown>);
}

export async function updateClosingItem(
  itemId: string,
  input: ClosingItemInput
): Promise<ClosingItemRow> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.closing_items
    WHERE id = ${itemId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new Error("closing_item_not_found");
  const cur = rowToClosingItem(rows[0] as Record<string, unknown>);
  const status =
    input.status !== undefined &&
    (CLOSING_STATUSES as readonly string[]).includes(input.status)
      ? input.status
      : cur.status;
  await db`
    UPDATE diligence.closing_items
    SET category = ${input.category !== undefined && (CLOSING_CATEGORIES as readonly string[]).includes(input.category) ? input.category : cur.category},
        title = ${input.title !== undefined ? input.title.trim() : cur.title},
        status = ${status},
        due_date = ${input.dueDate !== undefined ? cleanDate(input.dueDate) : cur.dueDate},
        completed_at = ${status === "done" && cur.status !== "done" ? new Date().toISOString() : status === "open" ? null : cur.completedAt},
        notes = ${input.notes !== undefined ? input.notes : cur.notes},
        updated_at = now()
    WHERE id = ${itemId}`;
  const after = await db`
    SELECT * FROM diligence.closing_items WHERE id = ${itemId} LIMIT 1`;
  return rowToClosingItem(after[0] as Record<string, unknown>);
}

export async function deleteClosingItem(itemId: string): Promise<boolean> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    UPDATE diligence.closing_items SET deleted_at = now(), updated_at = now()
    WHERE id = ${itemId} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/* ------------------------- calendar generator feeds --------------------- */
/* Consumed by lib/calgen/service.ts generators (kinds: closing,         */
/* milestone) through dynamic import — the same plug-in pattern the      */
/* task generator uses. Dates are plain YYYY-MM-DD; the calgen layer    */
/* anchors them to Phoenix time.                                        */

export interface ClosingCalendarItem {
  itemId: string;
  workspaceId: string;
  dealId: string;
  companyId: string | null;
  dealName: string;
  title: string;
  category: string;
  dueDate: string;
  status: string;
}

export async function listClosingCalendarItems(): Promise<
  ClosingCalendarItem[]
> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT ci.id, ci.workspace_id, ci.title, ci.category, ci.due_date,
      ci.status, w.deal_id, w.company_id,
      coalesce(ld.company_name, co.name, '') AS deal_name
    FROM diligence.closing_items ci
    JOIN diligence.workspaces w ON w.id = ci.workspace_id
      AND w.deleted_at IS NULL
    LEFT JOIN deals ld ON ld.id = w.deal_id
    LEFT JOIN core.companies co ON co.id = w.company_id
    WHERE ci.deleted_at IS NULL
      AND ci.category = 'post_closing'
      AND ci.due_date IS NOT NULL`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      itemId: str(rec.id),
      workspaceId: str(rec.workspace_id),
      dealId: str(rec.deal_id),
      companyId: rec.company_id ? str(rec.company_id) : null,
      dealName: str(rec.deal_name),
      title: str(rec.title),
      category: str(rec.category),
      dueDate: dateOrNull(rec.due_date) ?? "",
      status: str(rec.status),
    };
  });
}

export interface MilestoneCalendarItem {
  itemId: string;
  workspaceId: string;
  dealId: string;
  companyId: string | null;
  dealName: string;
  title: string;
  workstream: string;
  dueDate: string;
  status: string;
}

export async function listMilestoneCalendarItems(): Promise<
  MilestoneCalendarItem[]
> {
  await ensureDiligence();
  const db = sql();
  const rows = await db`
    SELECT ci.id, ci.workspace_id, ci.title, ci.workstream, ci.due_date,
      ci.status, w.deal_id, w.company_id,
      coalesce(ld.company_name, co.name, '') AS deal_name
    FROM diligence.checklist_items ci
    JOIN diligence.workspaces w ON w.id = ci.workspace_id
      AND w.deleted_at IS NULL
    LEFT JOIN deals ld ON ld.id = w.deal_id
    LEFT JOIN core.companies co ON co.id = w.company_id
    WHERE ci.deleted_at IS NULL AND ci.due_date IS NOT NULL`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      itemId: str(rec.id),
      workspaceId: str(rec.workspace_id),
      dealId: str(rec.deal_id),
      companyId: rec.company_id ? str(rec.company_id) : null,
      dealName: str(rec.deal_name),
      title: str(rec.title),
      workstream: str(rec.workstream),
      dueDate: dateOrNull(rec.due_date) ?? "",
      status: str(rec.status),
    };
  });
}

/* ------------------------------ bundle --------------------------------- */

export interface WorkspaceBundle {
  workspace: WorkspaceRow;
  deal: DealContext | null;
  room: { id: string; name: string } | null;
  checklist: ChecklistItemRow[];
  requestItems: RequestItemRow[];
  requestSends: RequestSendRow[];
  findings: FindingRow[];
  contracts: ContractRow[];
  licenses: LicenseRow[];
  siteVisits: SiteVisitRow[];
  redFlags: RedFlagRow[];
  closingItems: ClosingItemRow[];
  counts: {
    checklistTotal: number;
    checklistDone: number;
    requestsOutstanding: number;
    findingsProposed: number;
    redFlagsOpen: number;
    redFlagsCandidate: number;
    closingOpen: number;
  };
}

export async function getWorkspaceBundle(
  workspaceId: string
): Promise<WorkspaceBundle> {
  const ws = await requireWorkspace(workspaceId);
  // Spec §10: when a new analysis has landed, its anomalies APPEAR as
  // candidate red flags — so opening the workspace syncs candidates
  // first (best-effort; a sync failure never blocks the read, and the
  // explicit sync endpoint remains for on-demand refresh + counts).
  await syncRedFlagCandidates(workspaceId).catch(() => null);
  const [
    deal,
    room,
    checklist,
    requestItems,
    requestSends,
    findings,
    contracts,
    licenses,
    siteVisits,
    redFlags,
    closingItems,
  ] = await Promise.all([
    getDealContext(ws.dealId),
    findRoomForDeal(ws.dealId),
    listChecklistItems(workspaceId),
    listRequestItems(workspaceId),
    listRequestSends(workspaceId),
    listFindings(workspaceId),
    listContracts(workspaceId),
    listLicenses(workspaceId),
    listSiteVisits(workspaceId),
    listRedFlags(workspaceId),
    listClosingItems(workspaceId),
  ]);
  const doneStatuses = ["received", "reviewed", "approved", "waived", "na"];
  return {
    workspace: ws,
    deal,
    room,
    checklist,
    requestItems,
    requestSends,
    findings,
    contracts,
    licenses,
    siteVisits,
    redFlags,
    closingItems,
    counts: {
      checklistTotal: checklist.length,
      checklistDone: checklist.filter((i) => doneStatuses.includes(i.status))
        .length,
      requestsOutstanding: requestItems.filter((i) => i.status === "requested")
        .length,
      findingsProposed: findings.filter((f) => f.status === "proposed")
        .length,
      redFlagsOpen: redFlags.filter((f) =>
        ["open", "mitigating"].includes(f.status)
      ).length,
      redFlagsCandidate: redFlags.filter((f) => f.status === "candidate")
        .length,
      closingOpen: closingItems.filter((c) => c.status === "open").length,
    },
  };
}

export { DAY_MS };
