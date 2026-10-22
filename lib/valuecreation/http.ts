import { NextResponse } from "next/server";
import { getSessionUser, type AuthUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";

export const NO_STORE = { "Cache-Control": "private, no-store" };

/** Session gate shared by every value-creation route. */
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
      code === "plan_exists" ||
      code === "dependency_cycle" ||
      code === "already_exists"
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
    `[valuecreation:${scope}]`,
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

/* ------------------------- request body mappers ------------------------ */

import type { InitiativeInput } from "./service";

const sStr = (v: unknown) => (typeof v === "string" ? v : undefined);
const sDate = (v: unknown) =>
  typeof v === "string" || v === null ? (v as string | null) : undefined;
const sNum = (v: unknown) =>
  typeof v === "number" || v === null ? (v as number | null) : undefined;

export function initiativeInputFrom(
  body: Record<string, unknown>
): InitiativeInput {
  return {
    title: sStr(body.title),
    description: sStr(body.description),
    category: sStr(body.category),
    status: sStr(body.status),
    ownerName: sStr(body.ownerName),
    ownerPersonId: sDate(body.ownerPersonId),
    startDate: sDate(body.startDate),
    endDate: sDate(body.endDate),
    oneTimeCost: sNum(body.oneTimeCost),
    recurringCost: sNum(body.recurringCost),
    ebitdaImpact: sNum(body.ebitdaImpact),
    confidence:
      typeof body.confidence === "number" ? body.confidence : undefined,
    effort: sNum(body.effort),
    playbookId: sDate(body.playbookId),
    sourceKind: sStr(body.sourceKind),
    sourceRef:
      body.sourceRef && typeof body.sourceRef === "object"
        ? (body.sourceRef as Record<string, unknown>)
        : undefined,
    sort: typeof body.sort === "number" ? body.sort : undefined,
  };
}
