import bcrypt from "bcryptjs";
import { sql, str, isoOrNull } from "../platform/db";
import { ensurePortmgmt } from "./schema";

/**
 * Management user store (Phase 9, WS-A) — company-scoped LOGINS for
 * portfolio-company management teams, layered over core.user_roles.
 *
 * A management user is a core.user_roles row with:
 *   role          = 'guest'
 *   scope         = { companyIds: [...] }   (core company ids)
 *   display_name  = the person's name
 *   password_hash = bcrypt hash (set ONLY for management users —
 *                   partners authenticate via lib/auth.ts and never
 *                   get a row hash; listManagementUsers keys off it)
 *   disabled_at   = set when the login is disabled / soft-deleted
 *
 * This module deliberately does NOT import lib/auth.ts (cycle risk):
 * lib/auth.ts verifyCredentials() dynamic-imports findLoginUser()
 * from here on a partner miss.
 *
 * Public shapes NEVER include the password hash.
 */

/** The seed partner login (lib/auth.ts) — never a management user. */
const SEED_PARTNER_EMAIL = "ethan@cannycapitalpartners.com";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 10;

export interface ManagementUser {
  email: string;
  name: string;
  role: "guest";
  companyIds: string[];
  disabled: boolean;
  updatedAt: string;
}

export interface CreateManagementUserInput {
  email: string;
  name: string;
  password: string;
  companyIds: string[];
}

export interface UpdateManagementUserInput {
  name?: string;
  companyIds?: string[];
  disabled?: boolean;
}

export interface LoginUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  companyIds: string[];
}

export interface LoginClaims {
  role: "guest";
  companyIds: string[];
}

type Row = Record<string, unknown>;

function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

function parseScope(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* malformed scope reads as empty */
    }
  }
  return {};
}

function scopeCompanyIds(scope: Record<string, unknown>): string[] {
  if (!Array.isArray(scope.companyIds)) return [];
  return Array.from(
    new Set(scope.companyIds.map((x) => String(x)).filter(Boolean))
  );
}

function rowToPublic(row: Row): ManagementUser {
  return {
    email: str(row.email),
    name: str(row.display_name),
    role: "guest",
    companyIds: scopeCompanyIds(parseScope(row.scope)),
    disabled: row.disabled_at !== null && row.disabled_at !== undefined,
    updatedAt: isoOrNull(row.updated_at) ?? "",
  };
}

async function getRow(email: string): Promise<Row | null> {
  const db = sql();
  const rows = await db`
    SELECT email, role, display_name, scope, disabled_at, updated_at,
      password_hash
    FROM core.user_roles WHERE email = ${email} LIMIT 1`;
  return rows.length ? (rows[0] as Row) : null;
}

/**
 * Create a company-scoped management login. Throws house-style coded
 * errors (Error with a snake_case message; routes map them):
 *   invalid_email — malformed address
 *   weak_password — fewer than 10 characters
 *   user_exists   — a row already carries a password hash, or the
 *                   address is the seed partner login
 * An existing hash-less, non-partner row (e.g. a role/scope stub) is
 * upgraded in place into the management login.
 */
export async function createManagementUser(
  input: CreateManagementUserInput,
  actor: string
): Promise<ManagementUser> {
  void actor; // actor is part of the contract (audit context for callers)
  await ensurePortmgmt();
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email)) throw new Error("invalid_email");
  const password = input.password ?? "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error("weak_password");
  }
  const name = (input.name ?? "").trim();
  const companyIds = Array.from(
    new Set((input.companyIds ?? []).map((x) => String(x)).filter(Boolean))
  );

  const existing = await getRow(email);
  if (existing) {
    const hasHash =
      typeof existing.password_hash === "string" &&
      existing.password_hash !== "";
    if (hasHash || email === SEED_PARTNER_EMAIL) {
      throw new Error("user_exists");
    }
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const scopeJson = JSON.stringify({ companyIds });
  const db = sql();
  if (existing) {
    await db`
      UPDATE core.user_roles
      SET role = 'guest', scope = ${scopeJson}::jsonb,
        display_name = ${name}, password_hash = ${passwordHash},
        disabled_at = NULL, updated_at = now()
      WHERE email = ${email}`;
  } else {
    await db`
      INSERT INTO core.user_roles
        (email, role, scope, display_name, password_hash)
      VALUES (${email}, 'guest', ${scopeJson}::jsonb, ${name},
        ${passwordHash})`;
  }
  const row = await getRow(email);
  return rowToPublic(row as Row);
}

/** The management population: rows carrying a password hash. */
export async function listManagementUsers(): Promise<ManagementUser[]> {
  await ensurePortmgmt();
  const db = sql();
  const rows = await db`
    SELECT email, display_name, scope, disabled_at, updated_at,
      password_hash
    FROM core.user_roles
    WHERE password_hash IS NOT NULL
    ORDER BY email`;
  return rows.map((r) => rowToPublic(r as Row));
}

/**
 * Update name / company scope / disabled flag. Throws user_not_found
 * when no row exists for the address.
 */
export async function updateManagementUser(
  emailRaw: string,
  input: UpdateManagementUserInput
): Promise<ManagementUser> {
  await ensurePortmgmt();
  const email = normalizeEmail(emailRaw);
  const existing = await getRow(email);
  if (!existing) throw new Error("user_not_found");
  const db = sql();

  if (typeof input.name === "string") {
    await db`
      UPDATE core.user_roles SET display_name = ${input.name.trim()},
        updated_at = now()
      WHERE email = ${email}`;
  }
  if (Array.isArray(input.companyIds)) {
    const scope = parseScope(existing.scope);
    scope.companyIds = Array.from(
      new Set(input.companyIds.map((x) => String(x)).filter(Boolean))
    );
    await db`
      UPDATE core.user_roles SET scope = ${JSON.stringify(scope)}::jsonb,
        updated_at = now()
      WHERE email = ${email}`;
  }
  if (typeof input.disabled === "boolean") {
    if (input.disabled) {
      await db`
        UPDATE core.user_roles SET disabled_at = now(),
          updated_at = now()
        WHERE email = ${email}`;
    } else {
      await db`
        UPDATE core.user_roles SET disabled_at = NULL,
          updated_at = now()
        WHERE email = ${email}`;
    }
  }
  const row = await getRow(email);
  return rowToPublic(row as Row);
}

/** Replace a management user's password (length >= 10 enforced). */
export async function setManagementUserPassword(
  emailRaw: string,
  password: string
): Promise<ManagementUser> {
  await ensurePortmgmt();
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error("weak_password");
  }
  const email = normalizeEmail(emailRaw);
  const existing = await getRow(email);
  if (!existing) throw new Error("user_not_found");
  const passwordHash = bcrypt.hashSync(password, 10);
  const db = sql();
  await db`
    UPDATE core.user_roles SET password_hash = ${passwordHash},
      updated_at = now()
    WHERE email = ${email}`;
  const row = await getRow(email);
  return rowToPublic(row as Row);
}

/**
 * Soft-delete a management login: stamps disabled_at and CLEARS the
 * password hash, so the credential can never authenticate again and
 * the row drops out of listManagementUsers(). Returns false when no
 * row exists.
 */
export async function deleteManagementUser(
  emailRaw: string
): Promise<boolean> {
  await ensurePortmgmt();
  const email = normalizeEmail(emailRaw);
  const existing = await getRow(email);
  if (!existing) return false;
  const db = sql();
  await db`
    UPDATE core.user_roles SET disabled_at = now(),
      password_hash = NULL, updated_at = now()
    WHERE email = ${email}`;
  return true;
}

/**
 * Login lookup for lib/auth.ts verifyCredentials(): only live
 * (non-disabled) rows carrying a password hash can authenticate.
 * id is namespaced `pm:<email>` so it can never collide with a
 * partner id.
 */
export async function findLoginUser(
  emailRaw: string
): Promise<LoginUser | null> {
  await ensurePortmgmt();
  const email = normalizeEmail(emailRaw);
  if (!email) return null;
  const db = sql();
  const rows = await db`
    SELECT email, display_name, scope, password_hash
    FROM core.user_roles
    WHERE email = ${email} AND password_hash IS NOT NULL
      AND disabled_at IS NULL
    LIMIT 1`;
  if (!rows.length) return null;
  const row = rows[0] as Row;
  const passwordHash =
    typeof row.password_hash === "string" ? row.password_hash : "";
  if (!passwordHash) return null;
  return {
    id: `pm:${email}`,
    name: str(row.display_name) || email,
    email,
    passwordHash,
    companyIds: scopeCompanyIds(parseScope(row.scope)),
  };
}

/**
 * Claims for the login route: a live management user yields
 * { role: 'guest', companyIds } to stamp into the session token;
 * anything else (partners, unknown, disabled) yields null.
 */
export async function getLoginClaims(
  emailRaw: string
): Promise<LoginClaims | null> {
  const login = await findLoginUser(emailRaw);
  if (!login) return null;
  return { role: "guest", companyIds: login.companyIds };
}

/* ------------------------------------------------------------------ */
/* Compat surface for the /api/portmgmt/users routes (WS-C): those   */
/* routes were written against short names and a create-then-set-    */
/* password flow (create carries no password; the password route     */
/* sets it). These wrappers keep that surface working on top of the  */
/* canonical store above. PortalUser widens ManagementUser with the  */
/* row's stored role (management users are always 'guest').          */
/* ------------------------------------------------------------------ */

export interface PortalUser {
  email: string;
  name: string;
  role: string;
  companyIds: string[];
  disabled: boolean;
  updatedAt: string;
}

function rowToPortal(row: Row): PortalUser {
  return {
    email: str(row.email),
    name: str(row.display_name),
    role: str(row.role) || "guest",
    companyIds: scopeCompanyIds(parseScope(row.scope)),
    disabled: row.disabled_at !== null && row.disabled_at !== undefined,
    updatedAt: isoOrNull(row.updated_at) ?? "",
  };
}

const VALID_ROLES = new Set(["admin", "internal", "guest"]);

/** All portal users (every core.user_roles row), PortalUser shapes. */
export async function listUsers(): Promise<PortalUser[]> {
  await ensurePortmgmt();
  const db = sql();
  const rows = await db`
    SELECT email, role, display_name, scope, disabled_at, updated_at,
      password_hash
    FROM core.user_roles
    ORDER BY email`;
  return rows.map((r) => rowToPortal(r as Row));
}

export interface CreateUserInput {
  email: string;
  name?: string;
  role?: string;
  companyIds?: string[];
  password?: string;
}

/**
 * Create a portal user. With a password this is exactly
 * createManagementUser (a company-scoped guest login). Without one
 * it creates the role/scope row only — the credential is set later
 * via setUserPassword; until then the user cannot sign in and does
 * not appear in listManagementUsers (the password-hash population).
 */
export async function createUser(
  input: CreateUserInput,
  actor: string
): Promise<PortalUser> {
  if (typeof input.password === "string" && input.password !== "") {
    const created = await createManagementUser(
      {
        email: input.email,
        name: input.name ?? "",
        password: input.password,
        companyIds: input.companyIds ?? [],
      },
      actor
    );
    return { ...created, role: "guest" };
  }
  await ensurePortmgmt();
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email)) throw new Error("invalid_email");
  const existing = await getRow(email);
  if (existing) {
    const hasHash =
      typeof existing.password_hash === "string" &&
      existing.password_hash !== "";
    if (hasHash || email === SEED_PARTNER_EMAIL) {
      throw new Error("user_exists");
    }
  }
  const role =
    input.role && VALID_ROLES.has(input.role) ? input.role : "guest";
  const scopeJson = JSON.stringify({ companyIds: input.companyIds ?? [] });
  const name = (input.name ?? "").trim();
  const db = sql();
  if (existing) {
    await db`
      UPDATE core.user_roles
      SET role = ${role}, scope = ${scopeJson}::jsonb,
        display_name = ${name}, disabled_at = NULL, updated_at = now()
      WHERE email = ${email}`;
  } else {
    await db`
      INSERT INTO core.user_roles (email, role, scope, display_name)
      VALUES (${email}, ${role}, ${scopeJson}::jsonb, ${name})`;
  }
  const row = await getRow(email);
  return rowToPortal(row as Row);
}

export interface UpdateUserInput {
  name?: string;
  role?: string;
  companyIds?: string[];
  disabled?: boolean;
}

/** Update a portal user (name / role / companyIds / disabled). */
export async function updateUser(
  emailRaw: string,
  input: UpdateUserInput,
  actor: string
): Promise<PortalUser> {
  void actor;
  await ensurePortmgmt();
  const email = normalizeEmail(emailRaw);
  const existing = await getRow(email);
  if (!existing) throw new Error("user_not_found");
  const db = sql();
  if (typeof input.name === "string") {
    await db`
      UPDATE core.user_roles SET display_name = ${input.name.trim()},
        updated_at = now()
      WHERE email = ${email}`;
  }
  if (input.role && VALID_ROLES.has(input.role)) {
    await db`
      UPDATE core.user_roles SET role = ${input.role},
        updated_at = now()
      WHERE email = ${email}`;
  }
  if (Array.isArray(input.companyIds)) {
    const scope = parseScope(existing.scope);
    scope.companyIds = Array.from(
      new Set(input.companyIds.map((x) => String(x)).filter(Boolean))
    );
    await db`
      UPDATE core.user_roles SET scope = ${JSON.stringify(scope)}::jsonb,
        updated_at = now()
      WHERE email = ${email}`;
  }
  if (typeof input.disabled === "boolean") {
    if (input.disabled) {
      await db`
        UPDATE core.user_roles SET disabled_at = now(),
          updated_at = now()
        WHERE email = ${email}`;
    } else {
      await db`
        UPDATE core.user_roles SET disabled_at = NULL,
          updated_at = now()
        WHERE email = ${email}`;
    }
  }
  const row = await getRow(email);
  return rowToPortal(row as Row);
}

/** Soft-delete a portal user (see deleteManagementUser). */
export async function deleteUser(
  emailRaw: string,
  actor: string
): Promise<boolean> {
  void actor;
  return deleteManagementUser(emailRaw);
}

/** Set/reset a portal user's password (see setManagementUserPassword). */
export async function setUserPassword(
  emailRaw: string,
  password: string,
  actor: string
): Promise<PortalUser> {
  void actor;
  const updated = await setManagementUserPassword(emailRaw, password);
  return { ...updated, role: "guest" };
}
