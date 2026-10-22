import { sql, newId, str, isoOrNull } from "../platform/db";
import { ensureDataRoom } from "./schema";
import { writeActivity } from "./service";

/**
 * Data room Q&A (Phase 3): buyers (guests) ask questions inside the
 * room; the internal team answers. Threads optionally attach to a
 * document. An internal reply moves a thread to "answered"; a guest
 * reply re-opens it. Nothing here sends email or notifications —
 * the room is the channel (Phase 2 single-notification rule).
 */

export interface QaMessageRow {
  id: string;
  threadId: string;
  author: string;
  authorKind: string;
  body: string;
  createdAt: string;
}

export interface QaThreadRow {
  id: string;
  roomId: string;
  documentId: string | null;
  documentName: string;
  title: string;
  status: string;
  createdBy: string;
  createdByKind: string;
  createdAt: string;
  updatedAt: string;
  messages: QaMessageRow[];
}

export async function listThreads(roomId: string): Promise<QaThreadRow[]> {
  await ensureDataRoom();
  const db = sql();
  // One joined query (no N+1): threads + their messages, grouped in JS.
  // Thread order is newest-activity first; the 50-thread cap is applied
  // while grouping so a long room history stays bounded.
  const rows = await db`
    SELECT t.id, t.room_id, t.document_id, t.title, t.status, t.created_by,
      t.created_by_kind, t.created_at, t.updated_at,
      coalesce(d.name, '') AS document_name,
      m.id AS m_id, m.author AS m_author, m.author_kind AS m_author_kind,
      m.body AS m_body, m.created_at AS m_created_at
    FROM dataroom.qa_threads t
    LEFT JOIN core.documents d ON d.id = t.document_id
    LEFT JOIN dataroom.qa_messages m ON m.thread_id = t.id
    WHERE t.room_id = ${roomId}
    ORDER BY t.updated_at DESC, m.created_at ASC
    LIMIT 2000`;
  const byId = new Map<string, QaThreadRow>();
  const order: QaThreadRow[] = [];
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    const threadId = str(rec.id);
    let thread = byId.get(threadId);
    if (!thread) {
      if (order.length >= 50) continue;
      thread = {
        id: threadId,
        roomId: str(rec.room_id),
        documentId: rec.document_id ? str(rec.document_id) : null,
        documentName: str(rec.document_name),
        title: str(rec.title),
        status: str(rec.status) || "open",
        createdBy: str(rec.created_by),
        createdByKind: str(rec.created_by_kind),
        createdAt: isoOrNull(rec.created_at) ?? "",
        updatedAt: isoOrNull(rec.updated_at) ?? "",
        messages: [],
      };
      byId.set(threadId, thread);
      order.push(thread);
    }
    if (rec.m_id && thread.messages.length < 200) {
      thread.messages.push({
        id: str(rec.m_id),
        threadId,
        author: str(rec.m_author),
        authorKind: str(rec.m_author_kind),
        body: str(rec.m_body),
        createdAt: isoOrNull(rec.m_created_at) ?? "",
      });
    }
  }
  return order;
}

export async function createThread(
  roomId: string,
  input: { title: string; body: string; documentId?: string | null },
  author: string,
  authorKind: "internal" | "guest"
): Promise<QaThreadRow> {
  await ensureDataRoom();
  const db = sql();
  const title = input.title.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 4000);
  if (!title || !body) throw new Error("A question title and body are required");
  const threadId = newId();
  await db`
    INSERT INTO dataroom.qa_threads
      (id, room_id, document_id, title, status, created_by, created_by_kind)
    VALUES (${threadId}, ${roomId}, ${input.documentId ?? null}, ${title},
      'open', ${author}, ${authorKind})`;
  await db`
    INSERT INTO dataroom.qa_messages (id, thread_id, author, author_kind, body)
    VALUES (${newId()}, ${threadId}, ${author}, ${authorKind}, ${body})`;
  await writeActivity(
    "data_room",
    roomId,
    author,
    "qa_question",
    `${author} asked: ${title}`
  );
  const threads = await listThreads(roomId);
  const created = threads.find((t) => t.id === threadId);
  if (!created) throw new Error("Q&A thread creation failed");
  return created;
}

export async function replyToThread(
  roomId: string,
  threadId: string,
  body: string,
  author: string,
  authorKind: "internal" | "guest"
): Promise<QaThreadRow | null> {
  await ensureDataRoom();
  const db = sql();
  const text = body.trim().slice(0, 4000);
  if (!text) throw new Error("Reply body is required");
  const rows = await db`
    SELECT id, status FROM dataroom.qa_threads
    WHERE id = ${threadId} AND room_id = ${roomId} LIMIT 1`;
  if (!rows.length) return null;
  await db`
    INSERT INTO dataroom.qa_messages (id, thread_id, author, author_kind, body)
    VALUES (${newId()}, ${threadId}, ${author}, ${authorKind}, ${text})`;
  // Internal answer → answered; a guest follow-up re-opens.
  const nextStatus = authorKind === "internal" ? "answered" : "open";
  await db`
    UPDATE dataroom.qa_threads SET status = ${nextStatus}, updated_at = now()
    WHERE id = ${threadId}`;
  const threads = await listThreads(roomId);
  return threads.find((t) => t.id === threadId) ?? null;
}

export async function setThreadStatus(
  roomId: string,
  threadId: string,
  status: string,
  actor: string
): Promise<QaThreadRow | null> {
  await ensureDataRoom();
  if (!["open", "answered", "closed"].includes(status)) {
    throw new Error(`Invalid Q&A status: ${status}`);
  }
  const db = sql();
  const rows = await db`
    UPDATE dataroom.qa_threads SET status = ${status}, updated_at = now()
    WHERE id = ${threadId} AND room_id = ${roomId}
    RETURNING id`;
  if (!rows.length) return null;
  await writeActivity(
    "data_room",
    roomId,
    actor,
    "qa_status",
    `${actor} marked a Q&A thread ${status}`
  );
  const threads = await listThreads(roomId);
  return threads.find((t) => t.id === threadId) ?? null;
}
