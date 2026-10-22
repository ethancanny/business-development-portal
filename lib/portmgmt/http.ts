import { NextResponse } from "next/server";
import { getSessionUser, type AuthUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import {
  getAccessContext,
  canAccessCompany,
  type AccessContext,
} from "@/lib/platform/permissions";

export const NO_STORE = { "Cache-Control": "private, no-store" };

export type { AccessContext };

/**
 * Portfolio Management HTTP gate (Phase 9, WS-B) — mirrors
 * lib/monitoring/http.ts, extended with the WS-A access context:
 * authed() resolves the session user AND their AccessContext
 * ({ role, companyIds } — companyIds null = unrestricted internal).
 * Company-scoped routes must additionally pass companyGate();
 * internal-only routes pass internalGate().
 */
export async function authed(): Promise<
  { user: AuthUser; ctx: AccessContext } | { response: NextResponse }
> {
  const user = getSessionUser();
  if (!user) {
    return {
      response: NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: NO_STORE }
      ),
    };
  }
  await ensurePlatform();
  const ctx = await getAccessContext(user);
  return { user, ctx };
}

/** 403 unless the context may access this company; null = allowed. */
export function companyGate(
  ctx: AccessContext,
  companyId: string
): NextResponse | null {
  if (canAccessCompany(ctx, companyId)) return null;
  return NextResponse.json(
    { error: "forbidden" },
    { status: 403, headers: NO_STORE }
  );
}

/** 403 unless the context is internal (unrestricted); null = allowed. */
export function internalGate(ctx: AccessContext): NextResponse | null {
  if (ctx.companyIds === null) return null;
  return NextResponse.json(
    { error: "forbidden" },
    { status: 403, headers: NO_STORE }
  );
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

/**
 * House-style service error mapping (mirrors lib/monitoring/http.ts):
 * snake_case coded errors are client errors ('*_not_found' → 404;
 * conflicts → 409; validation codes → 400); anything else is a
 * generic 500 with the message logged server-side only.
 */
export function serviceError(err: unknown, scope: string): NextResponse {
  const rec =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const code =
    (typeof rec?.error === "string" && rec.error) ||
    (typeof rec?.code === "string" && rec.code) ||
    (err instanceof Error && /^[a-z][a-z0-9_]+$/.test(err.message)
      ? err.message
      : "");
  if (code) {
    if (code.endsWith("_not_found")) {
      return NextResponse.json(
        { error: code },
        { status: 404, headers: NO_STORE }
      );
    }
    if (code === "already_exists" || code.endsWith("_exists")) {
      return NextResponse.json(
        { error: code },
        { status: 409, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { error: code },
      { status: 400, headers: NO_STORE }
    );
  }
  console.error(
    `[portmgmt:${scope}]`,
    err instanceof Error ? err.message : String(err)
  );
  return NextResponse.json(
    { error: "internal_error" },
    { status: 500, headers: NO_STORE }
  );
}

export async function readBody(
  req: Request
): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/* ------------------------- request body helpers ------------------------ */

export const sStr = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
export const sNum = (v: unknown): number | null | undefined =>
  typeof v === "number" || v === null ? (v as number | null) : undefined;
export const sDate = (v: unknown): string | null | undefined =>
  typeof v === "string" || v === null ? (v as string | null) : undefined;
export const sStrArr = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : undefined;
