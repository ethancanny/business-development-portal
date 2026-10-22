import { sql, str } from "./db";
import type { AuthUser } from "../auth";

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

/* ------------------ company-scoped access (Phase 9) ------------------ */

/**
 * Resolved access for a session user. companyIds === null means
 * UNRESTRICTED (admin/internal); an array means the user may only
 * reach those core company ids (portfolio-company management logins
 * carry role 'guest' + a company scope).
 */
export interface AccessContext {
  role: Role;
  companyIds: string[] | null;
}

/**
 * Resolve the access context for a session user. Token claims win
 * first (a guest session stamped with companyIds at login — see
 * lib/portmgmt/users.ts getLoginClaims); otherwise the DB role/scope
 * decides. admin/internal are unrestricted; a guest without a stored
 * company scope is scoped to NO companies (empty array).
 */
export async function getAccessContext(
  user: AuthUser
): Promise<AccessContext> {
  if (user.role === "guest" && Array.isArray(user.companyIds)) {
    return {
      role: "guest",
      companyIds: Array.from(new Set(user.companyIds.map((x) => String(x)))),
    };
  }
  const role = await getUserRole(user.email);
  if (role === "admin" || role === "internal") {
    return { role, companyIds: null };
  }
  const scope = await getUserScope(user.email);
  const companyIds = Array.isArray(scope.companyIds)
    ? Array.from(
        new Set(scope.companyIds.map((x) => String(x)).filter(Boolean))
      )
    : [];
  return { role, companyIds };
}

/** True when the context may reach the given company. */
export function canAccessCompany(
  ctx: AccessContext,
  companyId: string
): boolean {
  return ctx.companyIds === null || ctx.companyIds.includes(companyId);
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
  // Phase 9: company-scoped management logins — a guest whose stored
  // scope carries companyIds may access company / portfolio_company /
  // monitoring scopes naming one of those companies.
  const scopedCompanies = Array.isArray(userScope.companyIds)
    ? userScope.companyIds.map((x) => String(x))
    : [];
  if (
    scopedCompanies.length &&
    (scope.kind === "company" ||
      scope.kind === "portfolio_company" ||
      scope.kind === "monitoring") &&
    scope.id !== undefined &&
    scopedCompanies.includes(scope.id)
  ) {
    return true;
  }
  const granted = Array.isArray(userScope.dataRoomIds)
    ? userScope.dataRoomIds.map((x) => String(x))
    : [];
  if (!granted.length) return false;
  const roomId = scope.dataRoomId ?? (scope.kind === "data_room" ? scope.id : undefined);
  return roomId !== undefined && granted.includes(roomId);
}
