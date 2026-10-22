import { NextResponse } from "next/server";
import { getSessionUser, type AuthUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";

export const NO_STORE = { "Cache-Control": "private, no-store" };

/** Session gate shared by every diligence route. The session read
 * comes first: it reads cookies (marking the route dynamic so Next
 * never prerenders these handlers) and is the cheaper check. */
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
 * client errors ('*_not_found' → 404, conflicts → 409, the Phase 4
 * EBITDA gate keeps its detail fields); anything else is a generic
 * 500 with the message logged server-side only (never figures).
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
    const extra: Record<string, unknown> = {};
    if (rec) {
      for (const key of [
        "ebitdaStated",
        "ebitdaComputed",
        "ebitdaVariance",
      ] as const) {
        if (key in rec) extra[key] = rec[key];
      }
    }
    if (code.endsWith("_not_found")) {
      return NextResponse.json(
        { error: code, ...extra },
        { status: 404, headers: NO_STORE }
      );
    }
    if (
      code === "adjustment_already_decided" ||
      code === "posted_immutable" ||
      code === "workspace_create_failed"
    ) {
      return NextResponse.json(
        { error: code, ...extra },
        { status: 409, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { error: code, ...extra },
      { status: 400, headers: NO_STORE }
    );
  }
  console.error(
    `[diligence:${scope}]`,
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

import type { ContractInput, LicenseInput } from "./service";

const sStr = (v: unknown) => (typeof v === "string" ? v : undefined);
const sDate = (v: unknown) =>
  typeof v === "string" || v === null ? (v as string | null) : undefined;

export function contractInputFrom(
  body: Record<string, unknown>
): ContractInput {
  return {
    counterparty: sStr(body.counterparty),
    contractType: sStr(body.contractType),
    title: sStr(body.title),
    effectiveDate: sDate(body.effectiveDate),
    expiryDate: sDate(body.expiryDate),
    renewalDate: sDate(body.renewalDate),
    autoRenew:
      typeof body.autoRenew === "boolean" ? body.autoRenew : undefined,
    changeOfControl: sStr(body.changeOfControl),
    terminationTerms: sStr(body.terminationTerms),
    keyTerms: sStr(body.keyTerms),
    annualValue:
      typeof body.annualValue === "number" || body.annualValue === null
        ? (body.annualValue as number | null)
        : undefined,
    documentId: sDate(body.documentId),
    notes: sStr(body.notes),
  };
}

export function licenseInputFrom(
  body: Record<string, unknown>
): LicenseInput {
  return {
    licenseType: sStr(body.licenseType),
    issuingBody: sStr(body.issuingBody),
    licenseNumber: sStr(body.licenseNumber),
    issuedDate: sDate(body.issuedDate),
    expiryDate: sDate(body.expiryDate),
    transferability: sStr(body.transferability),
    status: sStr(body.status),
    notes: sStr(body.notes),
  };
}
