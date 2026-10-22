import { sql, str } from "./db";

/**
 * Role-based access (PROJECT_RULES.md security). Roles: admin (full),
 * internal (firm team), guest (external, limited to specific data rooms).
 * Data-room scoping lands in Phase 3; until then guests get no platform
 * data access through canAccess() — see the stub note below.
 */

export type Role = "admin" | "internal" | "guest";

export interface AccessScope {
  /** What is being accessed, e.g. "company", "deal", "data_room", "document". */
  kind: string;
  id?: string;
  /** Set when the access is inside a specific data room (Phase 3). */
  dataRoomId?: string;
}

export async function getUserRole(email: string): Promise<Role> {
  const e = (email ?? "").trim().toLowerCase();
  if (e) {
    try {
      const db = sql();
      const rows = await db`
        SELECT role FROM core.user_roles WHERE email = ${e} LIMIT 1`;
      if (rows.length) {
        const r = str(rows[0].role);
        if (r === "admin" || r === "internal" || r === "guest") return r;
      }
    } catch {
      /* fall through to the defaults below */
    }
  }
  if (e === "ethan@cannycapitalpartners.com") return "admin";
  if (e.endsWith("@cannycapitalpartners.com")) return "internal";
  return "guest";
}

/** Read a user's stored access scope (core.user_roles.scope JSONB). */
export async function getUserScope(
  email: string
): Promise<Record<string, unknown>> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return {};
  try {
    const db = sql();
    const rows = await db`
      SELECT scope FROM core.user_roles WHERE email = ${e} LIMIT 1`;
    if (rows.length) {
      const raw = (rows[0] as Record<string, unknown>).scope;
      if (raw && typeof raw === "object") return raw as Record<string, unknown>;
      if (typeof raw === "string" && raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object") {
          return parsed as Record<string, unknown>;
        }
      }
    }
  } catch {
    /* fall through to empty scope */
  }
  return {};
}

/**
 * Access check. Admin + internal can access platform records. Guests
 * (Phase 3) are limited to SPECIFIC data rooms: their stored scope
 * carries { dataRoomIds: [...] } and access is granted only when the
 * requested scope names one of those rooms — either directly
 * (dataRoomId) or as a data_room/document scope inside the room.
 * Note the primary guest mechanism is the token link flow
 * (lib/dataroom/guests.ts), which enforces expiry/revocation/allowlist
 * itself; this helper covers session users carrying the guest role.
 */
export function canAccess(
  role: Role,
  scope: AccessScope,
  userScope: Record<string, unknown> = {}
): boolean {
  if (role === "admin" || role === "internal") return true;
  if (role !== "guest") return false;
  const granted = Array.isArray(userScope.dataRoomIds)
    ? userScope.dataRoomIds.map((x) => String(x))
    : [];
  if (!granted.length) return false;
  const roomId = scope.dataRoomId ?? (scope.kind === "data_room" ? scope.id : undefined);
  return roomId !== undefined && granted.includes(roomId);
}
