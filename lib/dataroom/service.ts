import { sql, newId, str, num, isoOrNull } from "../platform/db";
import { logUsage } from "../platform/usage";
import { getStorageProvider } from "../storage";
import {
  ensureDataRoom,
  CHECKLIST_STATUSES,
  type ChecklistStatus,
  type RoomTemplateStructure,
} from "./schema";

/**
 * Data Rooms service (Phase 3) — rooms, folders, checklist, templates.
 * Phase 5 (Due Diligence) consumes getRoomIndex() / getRoomChecklist()
 * from here; no other module queries dataroom tables directly.
 */

export interface RoomRow {
  id: string;
  dealId: string;
  companyId: string | null;
  dealName: string;
  name: string;
  provider: string;
  status: string;
  domainAllowlist: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoomSummary extends RoomRow {
  documentCount: number;
  checklistTotal: number;
  checklistSatisfied: number;
  completenessPct: number;
  openQaCount: number;
}

export interface FolderRow {
  id: string;
  roomId: string;
  parentId: string | null;
  name: string;
  sort: number;
  isTemplate: boolean;
  createdAt: string;
}

export interface ChecklistItemRow {
  id: string;
  roomId: string;
  folderId: string | null;
  label: string;
  required: boolean;
  status: ChecklistStatus;
  documentId: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface Completeness {
  total: number;
  satisfied: number;
  pct: number;
  missing: ChecklistItemRow[];
}

export interface RoomTemplateRow {
  id: string;
  name: string;
  structure: RoomTemplateStructure;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

function parseAllowlist(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string" && v) {
    try {
      const p = JSON.parse(v);
      if (Array.isArray(p)) return p.map((x) => String(x)).filter(Boolean);
    } catch {
      /* fall through */
    }
  }
  return [];
}

function rowToRoom(r: Record<string, unknown>): RoomRow {
  return {
    id: str(r.id),
    dealId: str(r.deal_id),
    companyId: r.company_id ? str(r.company_id) : null,
    dealName: str(r.deal_name),
    name: str(r.name),
    provider: str(r.provider) || "local",
    status: str(r.status) || "active",
    domainAllowlist: parseAllowlist(r.domain_allowlist),
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToChecklist(r: Record<string, unknown>): ChecklistItemRow {
  const status = str(r.status);
  return {
    id: str(r.id),
    roomId: str(r.room_id),
    folderId: r.folder_id ? str(r.folder_id) : null,
    label: str(r.label),
    required: Boolean(r.required),
    status: (CHECKLIST_STATUSES as readonly string[]).includes(status)
      ? (status as ChecklistStatus)
      : "missing",
    documentId: r.document_id ? str(r.document_id) : null,
    sort: num(r.sort),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

async function writeActivity(
  entityKind: string,
  entityId: string,
  actor: string,
  kind: string,
  message: string
): Promise<void> {
  try {
    const db = sql();
    await db`
      INSERT INTO core.activity_log (id, entity_kind, entity_id, actor, kind, message, source)
      VALUES (${newId()}, ${entityKind}, ${entityId}, ${actor}, ${kind},
        ${message.slice(0, 500)}, 'manual')`;
  } catch (err) {
    console.error("[dataroom] activity_log write failed", err);
  }
}

async function writeAudit(
  entityKind: string,
  entityId: string,
  actor: string,
  action: string,
  changes: Record<string, unknown>
): Promise<void> {
  try {
    const db = sql();
    await db`
      INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
      VALUES (${entityKind}, ${entityId}, ${actor}, ${action},
        ${JSON.stringify(changes)}::jsonb)`;
  } catch (err) {
    console.error("[dataroom] audit_log write failed", err);
  }
}

export { writeActivity, writeAudit };

/* ------------------------------ Templates ----------------------------- */

function rowToTemplate(r: Record<string, unknown>): RoomTemplateRow {
  let structure: RoomTemplateStructure = { folders: [] };
  const raw = r.structure;
  if (raw && typeof raw === "object") {
    structure = raw as RoomTemplateStructure;
  } else if (typeof raw === "string" && raw) {
    try {
      structure = JSON.parse(raw) as RoomTemplateStructure;
    } catch {
      /* keep empty */
    }
  }
  if (!Array.isArray(structure.folders)) structure = { folders: [] };
  return {
    id: str(r.id),
    name: str(r.name),
    structure,
    isDefault: Boolean(r.is_default),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function listTemplates(): Promise<RoomTemplateRow[]> {
  await ensureDataRoom();
  const db = sql();
  const rows = await db`
    SELECT id, name, structure, is_default, created_at, updated_at
    FROM dataroom.templates
    ORDER BY is_default DESC, created_at ASC`;
  return rows.map((r) => rowToTemplate(r as Record<string, unknown>));
}

export async function getTemplate(id: string): Promise<RoomTemplateRow | null> {
  await ensureDataRoom();
  const db = sql();
  const rows = await db`
    SELECT id, name, structure, is_default, created_at, updated_at
    FROM dataroom.templates WHERE id = ${id} LIMIT 1`;
  return rows.length ? rowToTemplate(rows[0] as Record<string, unknown>) : null;
}

export async function getDefaultTemplate(): Promise<RoomTemplateRow | null> {
  const all = await listTemplates();
  return all.find((t) => t.isDefault) ?? all[0] ?? null;
}

export async function saveTemplate(
  input: {
    id?: string;
    name: string;
    structure: RoomTemplateStructure;
    isDefault?: boolean;
  },
  actor: string
): Promise<RoomTemplateRow> {
  await ensureDataRoom();
  const db = sql();
  const structure: RoomTemplateStructure = {
    folders: (input.structure?.folders ?? [])
      .filter((f) => f && typeof f.name === "string" && f.name.trim())
      .map((f) => ({
        name: f.name.trim().slice(0, 120),
        items: (f.items ?? [])
          .filter((i) => typeof i === "string" && i.trim())
          .map((i) => i.trim().slice(0, 200)),
      })),
  };
  const id = input.id || newId();
  if (input.isDefault) {
    await db`UPDATE dataroom.templates SET is_default = false`;
  }
  const rows = await db`
    INSERT INTO dataroom.templates (id, name, structure, is_default)
    VALUES (${id}, ${input.name.trim().slice(0, 120)},
      ${JSON.stringify(structure)}::jsonb, ${Boolean(input.isDefault)})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, structure = EXCLUDED.structure,
      is_default = EXCLUDED.is_default, updated_at = now()
    RETURNING id, name, structure, is_default, created_at, updated_at`;
  await writeAudit("dataroom_template", id, actor, "save", {
    name: input.name,
  });
  return rowToTemplate(rows[0] as Record<string, unknown>);
}

/* -------------------------------- Rooms ------------------------------- */

const ROOM_COLS = `
  r.id, r.deal_id, r.company_id, r.name, r.provider, r.status,
  r.domain_allowlist, r.created_by, r.created_at, r.updated_at,
  coalesce(ld.company_name, co.name, '') AS deal_name`;

const ROOM_FROM = `
  FROM dataroom.rooms r
  LEFT JOIN deals ld ON ld.id = r.deal_id
  LEFT JOIN core.companies co ON co.id = r.company_id`;

export async function getRoom(id: string): Promise<RoomRow | null> {
  await ensureDataRoom();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(ROOM_COLS)} ${db.unsafe(ROOM_FROM)}
    WHERE r.id = ${id} AND r.deleted_at IS NULL LIMIT 1`;
  return rows.length ? rowToRoom(rows[0] as Record<string, unknown>) : null;
}

export async function listRooms(opts: {
  limit?: number;
  offset?: number;
}): Promise<{ items: RoomSummary[]; total: number }> {
  await ensureDataRoom();
  const db = sql();
  const limit = Math.min(50, Math.max(1, opts.limit || 25));
  const offset = Math.max(0, opts.offset || 0);
  const countRows = await db`
    SELECT count(*)::int AS n FROM dataroom.rooms WHERE deleted_at IS NULL`;
  const total = countRows.length ? num(countRows[0].n) : 0;
  const rows = await db`
    SELECT ${db.unsafe(ROOM_COLS)},
      (SELECT count(*)::int FROM dataroom.room_documents rd
        WHERE rd.room_id = r.id) AS doc_count,
      (SELECT count(*)::int FROM dataroom.checklist_items ci
        WHERE ci.room_id = r.id) AS cl_total,
      (SELECT count(*)::int FROM dataroom.checklist_items ci
        WHERE ci.room_id = r.id
          AND ci.status IN ('received', 'waived', 'na')) AS cl_satisfied,
      (SELECT count(*)::int FROM dataroom.qa_threads q
        WHERE q.room_id = r.id AND q.status = 'open') AS qa_open
    ${db.unsafe(ROOM_FROM)}
    WHERE r.deleted_at IS NULL
    ORDER BY r.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  const items: RoomSummary[] = rows.map((r) => {
    const rec = r as Record<string, unknown>;
    const clTotal = num(rec.cl_total);
    const clSatisfied = num(rec.cl_satisfied);
    return {
      ...rowToRoom(rec),
      documentCount: num(rec.doc_count),
      checklistTotal: clTotal,
      checklistSatisfied: clSatisfied,
      completenessPct: clTotal ? Math.round((100 * clSatisfied) / clTotal) : 0,
      openQaCount: num(rec.qa_open),
    };
  });
  logUsage("datarooms_list", items.length, JSON.stringify(items).length);
  return { items, total };
}

/**
 * Create the (single) room for a deal, materializing folders + the
 * checklist from a template. Idempotent: when an active room already
 * exists for the deal it is returned with existed=true.
 */
export async function createRoom(
  input: { dealId: string; name?: string; templateId?: string },
  actor: string
): Promise<{ room: RoomRow; existed: boolean }> {
  await ensureDataRoom();
  const db = sql();
  const dealId = (input.dealId ?? "").trim();
  if (!dealId) throw new Error("dealId is required");

  const existing = await db`
    SELECT ${db.unsafe(ROOM_COLS)} ${db.unsafe(ROOM_FROM)}
    WHERE r.deal_id = ${dealId} AND r.deleted_at IS NULL LIMIT 1`;
  if (existing.length) {
    return {
      room: rowToRoom(existing[0] as Record<string, unknown>),
      existed: true,
    };
  }

  // Resolve the deal → company link via the platform projection.
  const dealRows = await db`
    SELECT cd.id, cd.company_id,
      coalesce(ld.company_name, co.name, '') AS deal_name
    FROM core.deals cd
    LEFT JOIN deals ld ON ld.id = cd.id
    LEFT JOIN core.companies co ON co.id = cd.company_id
    WHERE cd.id = ${dealId} LIMIT 1`;
  if (!dealRows.length) throw new Error(`Deal not found: ${dealId}`);
  const deal = dealRows[0] as Record<string, unknown>;
  const companyId = deal.company_id ? str(deal.company_id) : null;
  const dealName = str(deal.deal_name);

  const template = input.templateId
    ? await getTemplate(input.templateId)
    : await getDefaultTemplate();
  if (!template) throw new Error("No room template available");

  const roomId = newId();
  const roomName =
    (input.name ?? "").trim() || (dealName ? `${dealName} — Data Room` : "Data Room");
  const provider = getStorageProvider().name;
  await db`
    INSERT INTO dataroom.rooms (id, deal_id, company_id, name, provider, created_by)
    VALUES (${roomId}, ${dealId}, ${companyId}, ${roomName}, ${provider}, ${actor})`;

  let sort = 0;
  for (const folder of template.structure.folders) {
    const folderId = newId();
    await db`
      INSERT INTO dataroom.folders (id, room_id, name, sort, is_template)
      VALUES (${folderId}, ${roomId}, ${folder.name}, ${sort}, true)`;
    let itemSort = 0;
    for (const label of folder.items) {
      await db`
        INSERT INTO dataroom.checklist_items (id, room_id, folder_id, label, sort)
        VALUES (${newId()}, ${roomId}, ${folderId}, ${label}, ${itemSort})`;
      itemSort += 1;
    }
    sort += 1;
  }

  await writeActivity(
    "data_room",
    roomId,
    actor,
    "room_created",
    `${actor} created the data room for ${dealName || dealId}`
  );
  await writeAudit("data_room", roomId, actor, "create", {
    dealId,
    templateId: template.id,
  });

  const room = await getRoom(roomId);
  if (!room) throw new Error("Room creation failed");
  return { room, existed: false };
}

export async function updateRoom(
  id: string,
  patch: { name?: string; domainAllowlist?: string[]; status?: string },
  actor: string
): Promise<RoomRow | null> {
  await ensureDataRoom();
  const db = sql();
  const room = await getRoom(id);
  if (!room) return null;
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 200) : room.name;
  const allow =
    patch.domainAllowlist !== undefined
      ? patch.domainAllowlist
          .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
          .filter(Boolean)
      : room.domainAllowlist;
  const status =
    patch.status === "archived" || patch.status === "active"
      ? patch.status
      : room.status;
  await db`
    UPDATE dataroom.rooms
    SET name = ${name}, domain_allowlist = ${JSON.stringify(allow)}::jsonb,
        status = ${status}, updated_at = now()
    WHERE id = ${id}`;
  await writeAudit("data_room", id, actor, "update", {
    name,
    status,
    domainAllowlist: allow,
  });
  return getRoom(id);
}

/* ------------------------------- Folders ------------------------------ */

export async function listFolders(roomId: string): Promise<FolderRow[]> {
  await ensureDataRoom();
  const db = sql();
  const rows = await db`
    SELECT id, room_id, parent_id, name, sort, is_template, created_at
    FROM dataroom.folders
    WHERE room_id = ${roomId} AND deleted_at IS NULL
    ORDER BY sort ASC, created_at ASC`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      id: str(rec.id),
      roomId: str(rec.room_id),
      parentId: rec.parent_id ? str(rec.parent_id) : null,
      name: str(rec.name),
      sort: num(rec.sort),
      isTemplate: Boolean(rec.is_template),
      createdAt: isoOrNull(rec.created_at) ?? "",
    };
  });
}

export async function addFolder(
  roomId: string,
  input: { name: string; parentId?: string | null },
  actor: string
): Promise<FolderRow> {
  await ensureDataRoom();
  const db = sql();
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Folder name is required");
  const maxRows = await db`
    SELECT coalesce(max(sort), -1) AS m FROM dataroom.folders
    WHERE room_id = ${roomId} AND deleted_at IS NULL`;
  const sort = (maxRows.length ? num(maxRows[0].m) : -1) + 1;
  const id = newId();
  const rows = await db`
    INSERT INTO dataroom.folders (id, room_id, parent_id, name, sort)
    VALUES (${id}, ${roomId}, ${input.parentId ?? null}, ${name}, ${sort})
    RETURNING id, room_id, parent_id, name, sort, is_template, created_at`;
  await writeActivity(
    "data_room",
    roomId,
    actor,
    "folder_added",
    `${actor} added folder "${name}"`
  );
  const rec = rows[0] as Record<string, unknown>;
  return {
    id: str(rec.id),
    roomId: str(rec.room_id),
    parentId: rec.parent_id ? str(rec.parent_id) : null,
    name: str(rec.name),
    sort: num(rec.sort),
    isTemplate: Boolean(rec.is_template),
    createdAt: isoOrNull(rec.created_at) ?? "",
  };
}

/* ------------------------------ Checklist ----------------------------- */

export async function getRoomChecklist(roomId: string): Promise<ChecklistItemRow[]> {
  await ensureDataRoom();
  const db = sql();
  const rows = await db`
    SELECT id, room_id, folder_id, label, required, status, document_id,
      sort, created_at, updated_at
    FROM dataroom.checklist_items
    WHERE room_id = ${roomId}
    ORDER BY sort ASC, created_at ASC`;
  return rows.map((r) => rowToChecklist(r as Record<string, unknown>));
}

export function computeCompleteness(items: ChecklistItemRow[]): Completeness {
  const satisfied = items.filter(
    (i) => i.status === "received" || i.status === "waived" || i.status === "na"
  ).length;
  return {
    total: items.length,
    satisfied,
    pct: items.length ? Math.round((100 * satisfied) / items.length) : 0,
    missing: items.filter((i) => i.status === "missing"),
  };
}

export async function addChecklistItem(
  roomId: string,
  input: { label: string; folderId?: string | null; required?: boolean },
  actor: string
): Promise<ChecklistItemRow> {
  await ensureDataRoom();
  const db = sql();
  const label = input.label.trim().slice(0, 200);
  if (!label) throw new Error("Checklist label is required");
  const maxRows = await db`
    SELECT coalesce(max(sort), -1) AS m FROM dataroom.checklist_items
    WHERE room_id = ${roomId}`;
  const sort = (maxRows.length ? num(maxRows[0].m) : -1) + 1;
  const rows = await db`
    INSERT INTO dataroom.checklist_items (id, room_id, folder_id, label, required, sort)
    VALUES (${newId()}, ${roomId}, ${input.folderId ?? null}, ${label},
      ${input.required !== false}, ${sort})
    RETURNING id, room_id, folder_id, label, required, status, document_id,
      sort, created_at, updated_at`;
  await writeActivity(
    "data_room",
    roomId,
    actor,
    "checklist_added",
    `${actor} added checklist item "${label}"`
  );
  return rowToChecklist(rows[0] as Record<string, unknown>);
}

export async function updateChecklistItem(
  roomId: string,
  itemId: string,
  patch: { status?: string; documentId?: string | null },
  actor: string
): Promise<ChecklistItemRow | null> {
  await ensureDataRoom();
  const db = sql();
  const rows = await db`
    SELECT id, room_id, folder_id, label, required, status, document_id,
      sort, created_at, updated_at
    FROM dataroom.checklist_items
    WHERE id = ${itemId} AND room_id = ${roomId} LIMIT 1`;
  if (!rows.length) return null;
  const current = rowToChecklist(rows[0] as Record<string, unknown>);
  let status = current.status;
  if (
    patch.status &&
    (CHECKLIST_STATUSES as readonly string[]).includes(patch.status)
  ) {
    status = patch.status as ChecklistStatus;
  }
  let documentId = current.documentId;
  if (patch.documentId !== undefined) {
    documentId = patch.documentId;
    // Linking a document to an item means the item was received.
    if (documentId && status === "missing") status = "received";
    if (!documentId && status === "received") status = "missing";
  }
  const updated = await db`
    UPDATE dataroom.checklist_items
    SET status = ${status}, document_id = ${documentId}, updated_at = now()
    WHERE id = ${itemId} AND room_id = ${roomId}
    RETURNING id, room_id, folder_id, label, required, status, document_id,
      sort, created_at, updated_at`;
  await writeActivity(
    "data_room",
    roomId,
    actor,
    "checklist_updated",
    `${actor} set "${current.label}" to ${status}`
  );
  return updated.length
    ? rowToChecklist(updated[0] as Record<string, unknown>)
    : null;
}

/* ------------------------- Room detail / index ------------------------ */

export interface RoomDocumentPlacement {
  documentId: string;
  folderId: string | null;
  addedBy: string;
  addedAt: string;
}

/**
 * The auto-generated room index: folders with their documents and the
 * checklist state. This is the service surface Phase 5 (Due Diligence)
 * builds on — keep its shape stable.
 */
export interface RoomIndex {
  room: RoomRow;
  folders: Array<{
    folder: FolderRow;
    documents: Array<{
      documentId: string;
      name: string;
      mime: string;
      sizeBytes: number;
      version: number;
      uploadedAt: string;
    }>;
  }>;
  unfiled: Array<{
    documentId: string;
    name: string;
    mime: string;
    sizeBytes: number;
    version: number;
    uploadedAt: string;
  }>;
  checklist: ChecklistItemRow[];
  completeness: Completeness;
  openQaCount: number;
}

export async function getRoomIndex(roomId: string): Promise<RoomIndex | null> {
  await ensureDataRoom();
  const db = sql();
  const room = await getRoom(roomId);
  if (!room) return null;
  const folders = await listFolders(roomId);
  const docRows = await db`
    SELECT rd.document_id, rd.folder_id, d.name, d.mime, d.size_bytes,
      d.current_version, d.created_at
    FROM dataroom.room_documents rd
    JOIN core.documents d ON d.id = rd.document_id
    WHERE rd.room_id = ${roomId} AND d.deleted_at IS NULL
    ORDER BY d.created_at ASC`;
  const byFolder = new Map<string, RoomIndex["unfiled"]>();
  const unfiled: RoomIndex["unfiled"] = [];
  for (const r of docRows) {
    const rec = r as Record<string, unknown>;
    const entry = {
      documentId: str(rec.document_id),
      name: str(rec.name),
      mime: str(rec.mime),
      sizeBytes: num(rec.size_bytes),
      version: num(rec.current_version) || 1,
      uploadedAt: isoOrNull(rec.created_at) ?? "",
    };
    const fid = rec.folder_id ? str(rec.folder_id) : "";
    if (fid) {
      const list = byFolder.get(fid) ?? [];
      list.push(entry);
      byFolder.set(fid, list);
    } else {
      unfiled.push(entry);
    }
  }
  const checklist = await getRoomChecklist(roomId);
  const qaRows = await db`
    SELECT count(*)::int AS n FROM dataroom.qa_threads
    WHERE room_id = ${roomId} AND status = 'open'`;
  return {
    room,
    folders: folders.map((folder) => ({
      folder,
      documents: byFolder.get(folder.id) ?? [],
    })),
    unfiled,
    checklist,
    completeness: computeCompleteness(checklist),
    openQaCount: qaRows.length ? num(qaRows[0].n) : 0,
  };
}
