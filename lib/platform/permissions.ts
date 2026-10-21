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

/**
 * Phase 1 stub: admin + internal can access platform records; guests are
 * denied everything until Phase 3 wires per-data-room grants
 * (core.user_roles.scope will carry { dataRoomIds: [...] } and this
 * helper will check scope.dataRoomId against the requested room).
 */
export function canAccess(role: Role, scope: AccessScope): boolean {
  if (role === "admin" || role === "internal") return true;
  // guest: no access yet — data-room-scoped grants land in Phase 3.
  void scope;
  return false;
}
