import { NextResponse } from "next/server";
import { getSessionUser, type AuthUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";

export const NO_STORE = { "Cache-Control": "private, no-store" };

/** Session gate shared by every comms route (mirrors lib/capital/http.ts). */
export async function authed(): Promise<
  { user: AuthUser } | { response: NextResponse }
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
  return { user };
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

/**
 * House-style service error mapping: snake_case coded errors are
 * client errors ('*_not_found' → 404; conflicts → 409; invalid_* and
 * other validation codes → 400); anything else is a generic 500 with
 * the message logged server-side only (never figures).
 *
 * Part 12 addition: 'send_blocked' → 409 (the deliver route attaches
 * the pre-send check to the error and returns it in the body itself;
 * this mapping is the fallback for routes that do not).
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
    if (
      code === "send_blocked" ||
      code === "already_exists" ||
      code === "profile_exists"
    ) {
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
    `[comms:${scope}]`,
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
