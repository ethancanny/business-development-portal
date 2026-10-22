import { sql, newId, str, num, isoOrNull, normalizeName } from "../platform/db";
import { logUsage } from "../platform/usage";
import { publishEvent } from "../platform/events";
import { enqueueJob } from "../platform/jobs";
import { getStorageProvider } from "../storage";
import { safeFilename } from "../storage/types";
import { ensureDataRoom } from "./schema";
import { writeActivity, writeAudit } from "./service";
import { createHash } from "crypto";

/**
 * Documents library service (Phase 3). core.documents is the canonical
 * record; versions live in dataroom.document_versions; bytes live in
 * the storage provider — never in Postgres. List queries return
 * metadata only (extracted text stays in dataroom.document_text).
 */

export interface DocumentRow {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  storageUrl: string;
  source: string;
  companyId: string | null;
  companyName: string;
  dealId: string | null;
  dealName: string;
  personId: string | null;
  tags: string[];
  contentHash: string;
  extractionStatus: string;
  currentVersion: number;
  legacyAttachmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersionRow {
  id: string;
  documentId: string;
  version: number;
  storageKey: string;
  provider: string;
  sizeBytes: number;
  mime: string;
  contentHash: string;
  uploadedBy: string;
  note: string;
  createdAt: string;
}

function parseTags(v: unknown): string[] {
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

const DOC_COLS = `
  d.id, d.name, d.mime, d.size_bytes, d.storage_url, d.source,
  d.company_id, d.deal_id, d.person_id, d.tags, d.content_hash,
  d.extraction_status, d.current_version, d.legacy_attachment_id,
  d.created_at, d.updated_at,
  coalesce(co.name, '') AS company_name,
  coalesce(ld.company_name, '') AS deal_name`;

const DOC_FROM = `
  FROM core.documents d
  LEFT JOIN core.companies co ON co.id = d.company_id
  LEFT JOIN deals ld ON ld.id = d.deal_id`;

function rowToDocument(r: Record<string, unknown>): DocumentRow {
  return {
    id: str(r.id),
    name: str(r.name),
    mime: str(r.mime),
    sizeBytes: num(r.size_bytes),
    storageUrl: str(r.storage_url),
    source: str(r.source),
    companyId: r.company_id ? str(r.company_id) : null,
    companyName: str(r.company_name),
    dealId: r.deal_id ? str(r.deal_id) : null,
    dealName: str(r.deal_name),
    personId: r.person_id ? str(r.person_id) : null,
    tags: parseTags(r.tags),
    contentHash: str(r.content_hash),
    extractionStatus: str(r.extraction_status) || "pending",
    currentVersion: num(r.current_version) || 1,
    legacyAttachmentId: r.legacy_attachment_id
      ? str(r.legacy_attachment_id)
      : null,
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToVersion(r: Record<string, unknown>): DocumentVersionRow {
  return {
    id: str(r.id),
    documentId: str(r.document_id),
    version: num(r.version),
    storageKey: str(r.storage_key),
    provider: str(r.provider) || "local",
    sizeBytes: num(r.size_bytes),
    mime: str(r.mime),
    contentHash: str(r.content_hash),
    uploadedBy: str(r.uploaded_by),
    note: str(r.note),
    createdAt: isoOrNull(r.created_at) ?? "",
  };
}

export async function getDocument(id: string): Promise<DocumentRow | null> {
  await ensureDataRoom();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(DOC_COLS)} ${db.unsafe(DOC_FROM)}
    WHERE d.id = ${id} AND d.deleted_at IS NULL LIMIT 1`;
  return rows.length ? rowToDocument(rows[0] as Record<string, unknown>) : null;
}

export async function listDocuments(opts: {
  q?: string;
  dealId?: string;
  companyId?: string;
  tag?: string;
  mime?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: DocumentRow[]; total: number }> {
  await ensureDataRoom();
  const db = sql();
  const q = (opts.q ?? "").trim();
  const like = `%${q}%`;
  const dealId = (opts.dealId ?? "").trim();
  const companyId = (opts.companyId ?? "").trim();
  const tag = (opts.tag ?? "").trim();
  const mime = (opts.mime ?? "").trim();
  const limit = Math.min(50, Math.max(1, opts.limit || 25));
  const offset = Math.max(0, opts.offset || 0);

  const mimeLike = `%${mime}%`;
  const countRows = await db`
    SELECT count(*)::int AS n ${db.unsafe(DOC_FROM)}
    WHERE d.deleted_at IS NULL
      AND (${dealId} = '' OR d.deal_id = ${dealId})
      AND (${companyId} = '' OR d.company_id = ${companyId})
      AND (${mime} = '' OR d.mime ILIKE ${mimeLike})
      AND (${tag} = '' OR d.tags @> ${JSON.stringify([tag])}::jsonb)
      AND (${q} = '' OR d.search_vector @@ plainto_tsquery('english', ${q})
        OR d.name ILIKE ${like})`;
  const total = countRows.length ? num(countRows[0].n) : 0;
  const rows = await db`
    SELECT ${db.unsafe(DOC_COLS)} ${db.unsafe(DOC_FROM)}
    WHERE d.deleted_at IS NULL
      AND (${dealId} = '' OR d.deal_id = ${dealId})
      AND (${companyId} = '' OR d.company_id = ${companyId})
      AND (${mime} = '' OR d.mime ILIKE ${mimeLike})
      AND (${tag} = '' OR d.tags @> ${JSON.stringify([tag])}::jsonb)
      AND (${q} = '' OR d.search_vector @@ plainto_tsquery('english', ${q})
        OR d.name ILIKE ${like})
    ORDER BY d.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  const items = rows.map((r) => rowToDocument(r as Record<string, unknown>));
  logUsage("documents_list", items.length, JSON.stringify(items).length);
  return { items, total };
}

export async function listDocumentVersions(
  documentId: string
): Promise<DocumentVersionRow[]> {
  await ensureDataRoom();
  const db = sql();
  const rows = await db`
    SELECT id, document_id, version, storage_key, provider, size_bytes,
      mime, content_hash, uploaded_by, note, created_at
    FROM dataroom.document_versions
    WHERE document_id = ${documentId}
    ORDER BY version DESC`;
  return rows.map((r) => rowToVersion(r as Record<string, unknown>));
}

export async function getDocumentRooms(
  documentId: string
): Promise<Array<{ roomId: string; roomName: string; folderId: string | null }>> {
  await ensureDataRoom();
  const db = sql();
  const rows = await db`
    SELECT rd.room_id, rd.folder_id, coalesce(r.name, '') AS room_name
    FROM dataroom.room_documents rd
    LEFT JOIN dataroom.rooms r ON r.id = rd.room_id
    WHERE rd.document_id = ${documentId}`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      roomId: str(rec.room_id),
      roomName: str(rec.room_name),
      folderId: rec.folder_id ? str(rec.folder_id) : null,
    };
  });
}

/** Storage key for a document version's bytes. */
export function versionKey(
  documentId: string,
  version: number,
  filename: string
): string {
  return `documents/${documentId}/v${version}/${safeFilename(filename)}`;
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Find another live document with identical bytes (duplicate warning). */
export async function findByHash(
  hash: string,
  excludeId?: string
): Promise<DocumentRow | null> {
  if (!hash) return null;
  await ensureDataRoom();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(DOC_COLS)} ${db.unsafe(DOC_FROM)}
    WHERE d.content_hash = ${hash} AND d.deleted_at IS NULL
      AND (${excludeId ?? ""} = '' OR d.id <> ${excludeId ?? ""})
    ORDER BY d.created_at ASC LIMIT 1`;
  return rows.length ? rowToDocument(rows[0] as Record<string, unknown>) : null;
}

/**
 * Register a fully-uploaded file: creates the core.documents row (or a
 * new version on an existing document), the version row, the room
 * placement, the document_uploaded event, and the extraction job.
 * Bytes are already at `storageKey` in the active provider.
 */
export async function registerUploadedDocument(input: {
  storageKey: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  contentHash: string;
  actor: string;
  existingDocumentId?: string | null;
  roomId?: string | null;
  folderId?: string | null;
  dealId?: string | null;
  companyId?: string | null;
  tags?: string[];
  note?: string;
}): Promise<{ document: DocumentRow; version: number }> {
  await ensureDataRoom();
  const db = sql();
  const provider = getStorageProvider().name;
  let documentId = input.existingDocumentId ?? "";
  let version = 1;

  if (documentId) {
    const existing = await getDocument(documentId);
    if (!existing) throw new Error(`Document not found: ${documentId}`);
    version = existing.currentVersion + 1;
    // The bytes were finalized under a temp-derived key; move them to
    // the canonical version key.
    const finalKey = versionKey(documentId, version, input.filename);
    if (input.storageKey !== finalKey) {
      await getStorageProvider().finalizeUpload(input.storageKey, finalKey);
    }
    await db`
      INSERT INTO dataroom.document_versions
        (id, document_id, version, storage_key, provider, size_bytes, mime,
          content_hash, uploaded_by, note)
      VALUES (${newId()}, ${documentId}, ${version}, ${finalKey}, ${provider},
        ${input.sizeBytes}, ${input.mime}, ${input.contentHash}, ${input.actor},
        ${input.note ?? ""})`;
    await db`
      UPDATE core.documents SET
        name = ${input.filename}, mime = ${input.mime},
        size_bytes = ${input.sizeBytes}, storage_url = ${finalKey},
        content_hash = ${input.contentHash}, current_version = ${version},
        extraction_status = 'pending', updated_at = now()
      WHERE id = ${documentId}`;
  } else {
    documentId = newId();
    const finalKey = versionKey(documentId, 1, input.filename);
    if (input.storageKey !== finalKey) {
      await getStorageProvider().finalizeUpload(input.storageKey, finalKey);
    }
    await db`
      INSERT INTO core.documents
        (id, company_id, deal_id, name, mime, size_bytes, storage_url,
          source, tags, content_hash, extraction_status, current_version,
          search_vector)
      VALUES (${documentId}, ${input.companyId ?? null},
        ${input.dealId ?? null}, ${input.filename}, ${input.mime},
        ${input.sizeBytes}, ${finalKey}, 'upload',
        ${JSON.stringify(input.tags ?? [])}::jsonb, ${input.contentHash},
        'pending', 1,
        setweight(to_tsvector('english', ${input.filename}), 'A'))`;
    await db`
      INSERT INTO dataroom.document_versions
        (id, document_id, version, storage_key, provider, size_bytes, mime,
          content_hash, uploaded_by, note)
      VALUES (${newId()}, ${documentId}, 1, ${finalKey}, ${provider},
        ${input.sizeBytes}, ${input.mime}, ${input.contentHash}, ${input.actor},
        ${input.note ?? ""})`;
  }

  if (input.roomId) {
    await db`
      INSERT INTO dataroom.room_documents (id, room_id, folder_id, document_id, added_by)
      VALUES (${newId()}, ${input.roomId}, ${input.folderId ?? null},
        ${documentId}, ${input.actor})
      ON CONFLICT (room_id, document_id) DO NOTHING`;
  }

  const document = await getDocument(documentId);
  if (!document) throw new Error("Document registration failed");

  await writeActivity(
    "document",
    documentId,
    input.actor,
    "document_uploaded",
    `${input.actor} uploaded ${input.filename} (v${version})`
  );
  if (input.roomId) {
    await writeActivity(
      "data_room",
      input.roomId,
      input.actor,
      "document_uploaded",
      `${input.actor} uploaded ${input.filename}`
    );
  }
  await publishEvent("document_uploaded", {
    entityKind: "document",
    entityId: documentId,
    actor: input.actor,
    payload: {
      name: input.filename,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      version,
      roomId: input.roomId ?? "",
      dealId: document.dealId ?? "",
      companyId: document.companyId ?? "",
    },
  });
  // Text extraction runs as a background job (drained opportunistically
  // by platform API activity, per the serverless job model).
  await enqueueJob("extract_document_text", { documentId });
  return { document, version };
}

export async function updateDocument(
  id: string,
  patch: {
    name?: string;
    tags?: string[];
    companyId?: string | null;
    dealId?: string | null;
    personId?: string | null;
  },
  actor: string
): Promise<DocumentRow | null> {
  await ensureDataRoom();
  const db = sql();
  const current = await getDocument(id);
  if (!current) return null;
  const name =
    patch.name !== undefined ? patch.name.trim().slice(0, 300) : current.name;
  const tags =
    patch.tags !== undefined
      ? patch.tags.map((t) => t.trim().slice(0, 60)).filter(Boolean)
      : current.tags;
  const companyId = patch.companyId !== undefined ? patch.companyId : current.companyId;
  const dealId = patch.dealId !== undefined ? patch.dealId : current.dealId;
  const personId = patch.personId !== undefined ? patch.personId : current.personId;
  await db`
    UPDATE core.documents SET
      name = ${name}, tags = ${JSON.stringify(tags)}::jsonb,
      company_id = ${companyId}, deal_id = ${dealId}, person_id = ${personId},
      search_vector =
        setweight(to_tsvector('english', ${name}), 'A') ||
        setweight(to_tsvector('english', ${tags.join(" ")}), 'B') ||
        coalesce((SELECT setweight(to_tsvector('english',
          left(dt.text, 100000)), 'B')
          FROM dataroom.document_text dt WHERE dt.document_id = ${id}),
          ''::tsvector),
      updated_at = now()
    WHERE id = ${id}`;
  await writeAudit("document", id, actor, "update", { name, tags });
  return getDocument(id);
}

export async function softDeleteDocument(
  id: string,
  actor: string
): Promise<boolean> {
  await ensureDataRoom();
  const db = sql();
  const rows = await db`
    UPDATE core.documents SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id`;
  if (rows.length) {
    await writeAudit("document", id, actor, "delete", {});
    await writeActivity(
      "document",
      id,
      actor,
      "document_deleted",
      `${actor} deleted a document`
    );
  }
  return rows.length > 0;
}

/**
 * Restore an older version: copies its bytes to a NEW current version
 * (history is append-only) and re-queues extraction.
 */
export async function restoreDocumentVersion(
  id: string,
  version: number,
  actor: string
): Promise<{ document: DocumentRow; version: number } | null> {
  await ensureDataRoom();
  const db = sql();
  const doc = await getDocument(id);
  if (!doc) return null;
  const versions = await listDocumentVersions(id);
  const target = versions.find((v) => v.version === version);
  if (!target) return null;
  const provider = getStorageProvider();
  const bytes = await provider.get(target.storageKey);
  const newVersion = doc.currentVersion + 1;
  const finalKey = versionKey(id, newVersion, doc.name);
  await provider.put(finalKey, bytes);
  await db`
    INSERT INTO dataroom.document_versions
      (id, document_id, version, storage_key, provider, size_bytes, mime,
        content_hash, uploaded_by, note)
    VALUES (${newId()}, ${id}, ${newVersion}, ${finalKey}, ${provider.name},
      ${target.sizeBytes}, ${target.mime}, ${target.contentHash}, ${actor},
      ${`Restored from v${version}`})`;
  await db`
    UPDATE core.documents SET
      size_bytes = ${target.sizeBytes}, mime = ${target.mime},
      storage_url = ${finalKey}, content_hash = ${target.contentHash},
      current_version = ${newVersion}, extraction_status = 'pending',
      updated_at = now()
    WHERE id = ${id}`;
  await writeActivity(
    "document",
    id,
    actor,
    "document_restored",
    `${actor} restored ${doc.name} to v${version} (now v${newVersion})`
  );
  await enqueueJob("extract_document_text", { documentId: id });
  const updated = await getDocument(id);
  return updated ? { document: updated, version: newVersion } : null;
}

/** Read a document version's bytes through the storage provider. */
export async function readDocumentBytes(
  doc: DocumentRow,
  version?: number
): Promise<{ bytes: Buffer; version: number; mime: string }> {
  const provider = getStorageProvider();
  if (version && version !== doc.currentVersion) {
    const versions = await listDocumentVersions(doc.id);
    const target = versions.find((v) => v.version === version);
    if (!target) throw new Error(`Version not found: ${version}`);
    return {
      bytes: await provider.get(target.storageKey),
      version: target.version,
      mime: target.mime || doc.mime,
    };
  }
  if (!doc.storageUrl) {
    throw new Error("Document has no stored file (metadata-only record)");
  }
  return {
    bytes: await provider.get(doc.storageUrl),
    version: doc.currentVersion,
    mime: doc.mime,
  };
}

/**
 * Duplicate detection for the library (platform dedupe pattern):
 * identical bytes (same SHA-256) and same normalized name with
 * different bytes (probable duplicates worth a human look).
 */
export async function findDocumentDuplicates(): Promise<{
  byHash: Array<{ hash: string; documents: DocumentRow[] }>;
  byName: Array<{ name: string; documents: DocumentRow[] }>;
}> {
  await ensureDataRoom();
  const db = sql();
  const hashRows = await db`
    SELECT content_hash FROM core.documents
    WHERE deleted_at IS NULL AND content_hash <> ''
    GROUP BY content_hash HAVING count(*) > 1
    ORDER BY count(*) DESC LIMIT 25`;
  const byHash: Array<{ hash: string; documents: DocumentRow[] }> = [];
  for (const r of hashRows) {
    const hash = str((r as Record<string, unknown>).content_hash);
    const docs = await db`
      SELECT ${db.unsafe(DOC_COLS)} ${db.unsafe(DOC_FROM)}
      WHERE d.content_hash = ${hash} AND d.deleted_at IS NULL
      ORDER BY d.created_at ASC LIMIT 25`;
    byHash.push({
      hash,
      documents: docs.map((d) => rowToDocument(d as Record<string, unknown>)),
    });
  }
  const allRows = await db`
    SELECT ${db.unsafe(DOC_COLS)} ${db.unsafe(DOC_FROM)}
    WHERE d.deleted_at IS NULL
    ORDER BY d.created_at DESC LIMIT 500`;
  const all = allRows.map((r) => rowToDocument(r as Record<string, unknown>));
  const groups = new Map<string, DocumentRow[]>();
  for (const d of all) {
    const key = normalizeName(d.name.replace(/\.[A-Za-z0-9]{1,8}$/, ""));
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(d);
    groups.set(key, list);
  }
  const byName = Array.from(groups.entries())
    .filter(
      ([, docs]) =>
        docs.length > 1 && new Set(docs.map((d) => d.contentHash)).size > 1
    )
    .slice(0, 25)
    .map(([name, documents]) => ({ name, documents }));
  return { byHash, byName };
}
