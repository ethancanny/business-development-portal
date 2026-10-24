import { createHash, randomBytes } from "crypto";
import { sql, newId, str, num, isoOrNull } from "../platform/db";
import { cached, cacheInvalidate } from "../platform/cache";
import { CACHE_TTLS } from "../platform/config";
import { getStorageStatus } from "../storage";
import { ensureDataRoom, type GuestAccessLevel } from "./schema";
import { getRoom, writeActivity, writeAudit, type RoomRow } from "./service";

/**
 * Guest access + access log (Phase 3).
 *
 * Guests are external users limited to ONE data room (rules). A grant
 * is a random 32-byte token; only its SHA-256 hash is stored, the raw
 * token is returned exactly once at creation. Validation enforces —
 * at OUR layer — revocation, expiry, room status, and the room's
 * domain allowlist. View-only guests are blocked from downloads by the
 * file routes (see app/api/guest/[token]/file/[docId]).
 */

export interface GuestRow {
  id: string;
  roomId: string;
  email: string;
  name: string;
  accessLevel: GuestAccessLevel;
  expiresAt: string;
  revokedAt: string | null;
  createdBy: string;
  lastAccessedAt: string | null;
  createdAt: string;
  /** Derived: not revoked and not expired. */
  active: boolean;
}

function rowToGuest(r: Record<string, unknown>): GuestRow {
  const expiresAt = isoOrNull(r.expires_at);
  const revokedAt = isoOrNull(r.revoked_at);
  const active =
    !revokedAt && (!expiresAt || new Date(expiresAt).getTime() > Date.now());
  return {
    id: str(r.id),
    roomId: str(r.room_id),
    email: str(r.email),
    name: str(r.name),
    accessLevel: str(r.access_level) === "download" ? "download" : "view",
    expiresAt: expiresAt ?? "",
    revokedAt,
    createdBy: str(r.created_by),
    lastAccessedAt: isoOrNull(r.last_accessed_at),
    createdAt: isoOrNull(r.created_at) ?? "",
    active,
  };
}

const GUEST_COLS = `
  id, room_id, email, name, access_level, expires_at, revoked_at,
  created_by, last_accessed_at, created_at`;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

export async function listGuests(roomId: string): Promise<GuestRow[]> {
  await ensureDataRoom();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(GUEST_COLS)} FROM dataroom.guests
    WHERE room_id = ${roomId}
    ORDER BY created_at DESC LIMIT 100`;
  return rows.map((r) => rowToGuest(r as Record<string, unknown>));
}

export async function createGuest(
  roomId: string,
  input: {
    email: string;
    name?: string;
    accessLevel?: string;
    expiresAt?: string;
    expiresInDays?: number;
  },
  actor: string
): Promise<{ guest: GuestRow; token: string; path: string }> {
  await ensureDataRoom();
  const room = await getRoom(roomId);
  if (!room) throw new Error(`Room not found: ${roomId}`);
  const email = (input.email ?? "").trim().toLowerCase().slice(0, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("A valid guest email is required");
  }
  // Per-room domain allowlist: when set, only listed domains get in.
  if (room.domainAllowlist.length) {
    const domain = emailDomain(email);
    if (!room.domainAllowlist.includes(domain)) {
      const err = new Error(
        `Domain ${domain || "(none)"} is not on this room's allowlist`
      ) as Error & { code?: string };
      err.code = "domain_not_allowed";
      throw err;
    }
  }
  // Restricted access (export-control safeguard, Step 1, Oct 23, 2026):
  // on a restricted room, guest invites are limited to APPROVED
  // parties — a Directory person with that email, a platform login
  // (core.user_roles), or an email on the room's domain allowlist.
  // Anyone else is refused before a token exists.
  if (room.restrictedAccess) {
    const db = sql();
    const domain = emailDomain(email);
    let approved = room.domainAllowlist.includes(domain);
    if (!approved) {
      const people = await db`
        SELECT id FROM core.people
        WHERE lower(email) = ${email} AND deleted_at IS NULL LIMIT 1`;
      approved = people.length > 0;
    }
    if (!approved) {
      const roles = await db`
        SELECT email FROM core.user_roles
        WHERE lower(email) = ${email} LIMIT 1`;
      approved = roles.length > 0;
    }
    if (!approved) {
      const err = new Error(
        `${email} is not an approved party for this restricted room. Add them to the Directory (or the room's domain allowlist) before inviting.`
      ) as Error & { code?: string };
      err.code = "guest_not_approved";
      throw err;
    }
  }
  let expiresAt: Date;
  if (input.expiresAt) {
    expiresAt = new Date(input.expiresAt);
    if (isNaN(expiresAt.getTime())) throw new Error("expiresAt is invalid");
  } else {
    const days = Math.min(365, Math.max(1, input.expiresInDays || 30));
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
  const accessLevel: GuestAccessLevel =
    input.accessLevel === "download" ? "download" : "view";
  const token = randomBytes(32).toString("base64url");
  const id = newId();
  const db = sql();
  const rows = await db`
    INSERT INTO dataroom.guests
      (id, room_id, email, name, token_hash, access_level, expires_at, created_by)
    VALUES (${id}, ${roomId}, ${email}, ${(input.name ?? "").trim().slice(0, 160)},
      ${hashToken(token)}, ${accessLevel}, ${expiresAt.toISOString()}, ${actor})
    RETURNING ${db.unsafe(GUEST_COLS)}`;
  const guest = rowToGuest(rows[0] as Record<string, unknown>);
  await writeActivity(
    "data_room",
    roomId,
    actor,
    "guest_invited",
    `${actor} granted ${accessLevel} access to ${email} (expires ${guest.expiresAt})`
  );
  await writeAudit("data_room_guest", id, actor, "create", {
    roomId,
    email,
    accessLevel,
    expiresAt: guest.expiresAt,
  });
  return { guest, token, path: `/room/${token}` };
}

export async function revokeGuest(
  roomId: string,
  guestId: string,
  actor: string
): Promise<boolean> {
  await ensureDataRoom();
  const db = sql();
  const rows = await db`
    UPDATE dataroom.guests SET revoked_at = now()
    WHERE id = ${guestId} AND room_id = ${roomId} AND revoked_at IS NULL
    RETURNING id`;
  if (rows.length) {
    await writeActivity(
      "data_room",
      roomId,
      actor,
      "guest_revoked",
      `${actor} revoked a guest link`
    );
    await writeAudit("data_room_guest", guestId, actor, "revoke", { roomId });
  }
  return rows.length > 0;
}

export type GuestValidation =
  | { ok: true; guest: GuestRow; room: RoomRow }
  | {
      ok: false;
      reason: "not_found" | "expired" | "revoked" | "room_inactive";
    };

/** Validate a raw guest token. Side effect: stamps last_accessed_at
 * (throttled to once per 5 minutes per guest). */
export async function validateGuestToken(
  token: string
): Promise<GuestValidation> {
  await ensureDataRoom();
  if (!token || token.length < 20) return { ok: false, reason: "not_found" };
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(GUEST_COLS)} FROM dataroom.guests
    WHERE token_hash = ${hashToken(token)} LIMIT 1`;
  if (!rows.length) return { ok: false, reason: "not_found" };
  const guest = rowToGuest(rows[0] as Record<string, unknown>);
  if (guest.revokedAt) return { ok: false, reason: "revoked" };
  if (guest.expiresAt && new Date(guest.expiresAt).getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  const room = await getRoom(guest.roomId);
  if (!room || room.status !== "active") {
    return { ok: false, reason: "room_inactive" };
  }
  // Re-check the room's CURRENT allowlist (it may have tightened since
  // the grant was issued).
  if (room.domainAllowlist.length) {
    if (!room.domainAllowlist.includes(emailDomain(guest.email))) {
      return { ok: false, reason: "revoked" };
    }
  }
  const last = guest.lastAccessedAt ? new Date(guest.lastAccessedAt).getTime() : 0;
  if (Date.now() - last > 5 * 60 * 1000) {
    await db`
      UPDATE dataroom.guests SET last_accessed_at = now() WHERE id = ${guest.id}`;
  }
  return { ok: true, guest, room };
}

/* ----------------------------- Access log ----------------------------- */

export interface AccessLogEntry {
  id: number;
  roomId: string | null;
  documentId: string | null;
  documentName: string;
  actor: string;
  actorKind: string;
  action: string;
  detail: string;
  createdAt: string;
}

export async function logAccess(input: {
  roomId?: string | null;
  documentId?: string | null;
  actor: string;
  actorKind: "internal" | "guest";
  action: string;
  detail?: string;
}): Promise<void> {
  try {
    await ensureDataRoom();
    const db = sql();
    await db`
      INSERT INTO dataroom.access_log
        (room_id, document_id, actor, actor_kind, action, detail)
      VALUES (${input.roomId ?? null}, ${input.documentId ?? null},
        ${input.actor}, ${input.actorKind}, ${input.action},
        ${(input.detail ?? "").slice(0, 300)})`;
    if (input.roomId) cacheInvalidate(`dataroom-access:${input.roomId}`);
  } catch (err) {
    console.error("[dataroom] access_log write failed", err);
  }
}

export interface AccessLogResult {
  /** "ok" for the local provider; "setup_required" for SharePoint rooms. */
  status: "ok" | "setup_required";
  entries: AccessLogEntry[];
  note?: string;
}

/**
 * Room access log, fetched on demand and cached 15 minutes (rules:
 * SYNC_INTERVALS.dataRoomAccessLogs). For SharePoint-backed rooms the
 * equivalent data lives in Graph audit/drive activity and cannot be
 * read until the Files/Sites scopes exist — reported honestly as
 * setup_required instead of an empty list.
 */
export async function getRoomAccessLog(
  room: RoomRow,
  opts: { fresh?: boolean } = {}
): Promise<AccessLogResult> {
  await ensureDataRoom();
  if (room.provider === "sharepoint") {
    const status = await getStorageStatus();
    return {
      status: "setup_required",
      entries: [],
      note:
        status.detail ||
        "SharePoint access logs require the Graph Files/Sites scopes.",
    };
  }
  const load = async (): Promise<AccessLogResult> => {
    const db = sql();
    const rows = await db`
      SELECT a.id, a.room_id, a.document_id, a.actor, a.actor_kind,
        a.action, a.detail, a.created_at,
        coalesce(d.name, '') AS document_name
      FROM dataroom.access_log a
      LEFT JOIN core.documents d ON d.id = a.document_id
      WHERE a.room_id = ${room.id}
      ORDER BY a.created_at DESC LIMIT 100`;
    return {
      status: "ok",
      entries: rows.map((r) => {
        const rec = r as Record<string, unknown>;
        return {
          id: num(rec.id),
          roomId: rec.room_id ? str(rec.room_id) : null,
          documentId: rec.document_id ? str(rec.document_id) : null,
          documentName: str(rec.document_name),
          actor: str(rec.actor),
          actorKind: str(rec.actor_kind),
          action: str(rec.action),
          detail: str(rec.detail),
          createdAt: isoOrNull(rec.created_at) ?? "",
        };
      }),
    };
  };
  if (opts.fresh) {
    cacheInvalidate(`dataroom-access:${room.id}`);
    return load();
  }
  return cached(
    `dataroom-access:${room.id}`,
    CACHE_TTLS.dataRoomAccessLogs,
    load
  );
}
