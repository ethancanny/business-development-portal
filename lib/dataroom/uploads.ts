import { sql, newId, str, num, isoOrNull } from "../platform/db";
import { getStorageProvider, StorageOffsetError } from "../storage";
import { ensureDataRoom, MAX_FILE_BYTES, UPLOAD_CHUNK_BYTES } from "./schema";
import { getRoom } from "./service";
import {
  findByHash,
  registerUploadedDocument,
  sha256Hex,
  type DocumentRow,
} from "./documents";

/**
 * Chunked / resumable upload sessions (Phase 3). A session row tracks
 * progress in dataroom.upload_sessions; the bytes accumulate in the
 * storage provider under a temp key. Completion hashes the file,
 * registers the document (core.documents + version + room placement),
 * publishes document_uploaded, and queues text extraction — all inside
 * registerUploadedDocument().
 */

export interface UploadSessionRow {
  id: string;
  roomId: string | null;
  folderId: string | null;
  documentId: string | null;
  dealId: string | null;
  companyId: string | null;
  filename: string;
  mime: string;
  tags: string[];
  totalSize: number;
  chunkSize: number;
  receivedBytes: number;
  status: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

function rowToSession(r: Record<string, unknown>): UploadSessionRow {
  let tags: string[] = [];
  const raw = r.tags;
  if (Array.isArray(raw)) tags = raw.map((x) => String(x));
  return {
    id: str(r.id),
    roomId: r.room_id ? str(r.room_id) : null,
    folderId: r.folder_id ? str(r.folder_id) : null,
    documentId: r.document_id ? str(r.document_id) : null,
    dealId: r.deal_id ? str(r.deal_id) : null,
    companyId: r.company_id ? str(r.company_id) : null,
    filename: str(r.filename),
    mime: str(r.mime),
    tags,
    totalSize: num(r.total_size),
    chunkSize: num(r.chunk_size) || UPLOAD_CHUNK_BYTES,
    receivedBytes: num(r.received_bytes),
    status: str(r.status) || "active",
    expiresAt: isoOrNull(r.expires_at) ?? "",
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

const SESSION_COLS = `
  id, room_id, folder_id, document_id, deal_id, company_id, filename,
  mime, tags, total_size, chunk_size, received_bytes, temp_key,
  uploaded_by, note, status, expires_at, created_at, updated_at`;

async function getSessionRow(
  id: string
): Promise<Record<string, unknown> | null> {
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(SESSION_COLS)} FROM dataroom.upload_sessions
    WHERE id = ${id} LIMIT 1`;
  return rows.length ? (rows[0] as Record<string, unknown>) : null;
}

export async function getUploadSession(
  id: string
): Promise<UploadSessionRow | null> {
  await ensureDataRoom();
  const rec = await getSessionRow(id);
  return rec ? rowToSession(rec) : null;
}

function assertUsable(rec: Record<string, unknown>, actor: string): void {
  if (str(rec.status) !== "active") {
    throw new Error(`Upload session is ${str(rec.status)}`);
  }
  if (str(rec.uploaded_by) && str(rec.uploaded_by) !== actor) {
    throw new Error("Upload session belongs to another user");
  }
  const expires = rec.expires_at ? new Date(String(rec.expires_at)) : null;
  if (expires && expires.getTime() < Date.now()) {
    throw new Error("Upload session has expired");
  }
}

export async function beginUploadSession(
  input: {
    filename: string;
    mime?: string;
    totalSize: number;
    roomId?: string | null;
    folderId?: string | null;
    documentId?: string | null;
    dealId?: string | null;
    companyId?: string | null;
    tags?: string[];
    note?: string;
  },
  actor: string
): Promise<UploadSessionRow> {
  await ensureDataRoom();
  const filename = (input.filename ?? "").trim().slice(0, 300);
  if (!filename) throw new Error("filename is required");
  const totalSize = Math.floor(input.totalSize || 0);
  if (totalSize <= 0) throw new Error("totalSize must be positive");
  if (totalSize > MAX_FILE_BYTES) {
    throw new Error(
      `File too large (${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB max)`
    );
  }

  let dealId = input.dealId ?? null;
  let companyId = input.companyId ?? null;
  if (input.roomId) {
    const room = await getRoom(input.roomId);
    if (!room) throw new Error(`Room not found: ${input.roomId}`);
    if (room.status !== "active") throw new Error("Room is archived");
    dealId = dealId ?? room.dealId ?? null;
    companyId = companyId ?? room.companyId ?? null;
  }

  const id = newId();
  const tempKey = `uploads/${id}.part`;
  const provider = getStorageProvider();
  await provider.beginUpload(tempKey);
  const db = sql();
  const rows = await db`
    INSERT INTO dataroom.upload_sessions
      (id, room_id, folder_id, document_id, deal_id, company_id, filename,
        mime, tags, total_size, chunk_size, temp_key, uploaded_by, note)
    VALUES (${id}, ${input.roomId ?? null}, ${input.folderId ?? null},
      ${input.documentId ?? null}, ${dealId}, ${companyId}, ${filename},
      ${(input.mime ?? "application/octet-stream").slice(0, 160)},
      ${JSON.stringify(input.tags ?? [])}::jsonb, ${totalSize},
      ${UPLOAD_CHUNK_BYTES}, ${tempKey}, ${actor}, ${input.note ?? ""})
    RETURNING ${db.unsafe(SESSION_COLS)}`;
  return rowToSession(rows[0] as Record<string, unknown>);
}

export async function appendUploadChunk(
  sessionId: string,
  offset: number,
  data: Buffer,
  actor: string
): Promise<{ receivedBytes: number }> {
  await ensureDataRoom();
  const rec = await getSessionRow(sessionId);
  if (!rec) throw new Error(`Upload session not found: ${sessionId}`);
  assertUsable(rec, actor);
  if (data.length > UPLOAD_CHUNK_BYTES) {
    throw new Error(
      `Chunk too large (${UPLOAD_CHUNK_BYTES} bytes max per chunk)`
    );
  }
  const provider = getStorageProvider();
  try {
    const received = await provider.appendChunk(
      str(rec.temp_key),
      offset,
      data
    );
    const db = sql();
    await db`
      UPDATE dataroom.upload_sessions
      SET received_bytes = ${received}, updated_at = now()
      WHERE id = ${sessionId}`;
    return { receivedBytes: received };
  } catch (err) {
    if (err instanceof StorageOffsetError) {
      // Surface the server's true offset so the client can resume.
      const current = await provider.uploadSize(str(rec.temp_key));
      const wrapped = new Error(
        `Chunk offset mismatch: server has ${current} bytes`
      ) as Error & { expected?: number };
      wrapped.expected = current;
      throw wrapped;
    }
    throw err;
  }
}

export async function completeUploadSession(
  sessionId: string,
  actor: string
): Promise<{ document: DocumentRow; version: number; duplicateOf: DocumentRow | null }> {
  await ensureDataRoom();
  const rec = await getSessionRow(sessionId);
  if (!rec) throw new Error(`Upload session not found: ${sessionId}`);
  assertUsable(rec, actor);
  const session = rowToSession(rec);
  const provider = getStorageProvider();
  const received = await provider.uploadSize(str(rec.temp_key));
  if (received !== session.totalSize) {
    throw new Error(
      `Upload incomplete: received ${received} of ${session.totalSize} bytes`
    );
  }
  const bytes = await provider.get(str(rec.temp_key));
  const contentHash = sha256Hex(bytes);

  const { document, version } = await registerUploadedDocument({
    storageKey: str(rec.temp_key),
    filename: session.filename,
    mime: session.mime,
    sizeBytes: session.totalSize,
    contentHash,
    actor,
    existingDocumentId: session.documentId,
    roomId: session.roomId,
    folderId: session.folderId,
    dealId: session.dealId,
    companyId: session.companyId,
    tags: session.tags,
    note: str(rec.note),
  });

  const db = sql();
  await db`
    UPDATE dataroom.upload_sessions
    SET status = 'completed', received_bytes = ${received}, updated_at = now()
    WHERE id = ${sessionId}`;

  const duplicateOf = await findByHash(contentHash, document.id);
  return { document, version, duplicateOf };
}

export async function abortUploadSession(
  sessionId: string,
  actor: string
): Promise<boolean> {
  await ensureDataRoom();
  const rec = await getSessionRow(sessionId);
  if (!rec) return false;
  if (str(rec.status) !== "active") return false;
  if (str(rec.uploaded_by) && str(rec.uploaded_by) !== actor) {
    throw new Error("Upload session belongs to another user");
  }
  await getStorageProvider().abortUpload(str(rec.temp_key));
  const db = sql();
  await db`
    UPDATE dataroom.upload_sessions SET status = 'aborted', updated_at = now()
    WHERE id = ${sessionId}`;
  return true;
}
