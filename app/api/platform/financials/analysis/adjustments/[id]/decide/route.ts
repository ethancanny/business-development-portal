import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureFinancials } from "@/lib/financials/schema";
import { ensureFinanalysis } from "@/lib/finanalysis/schema";
import { decideAdjustment } from "@/lib/finanalysis/service";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

const ERROR_DETAIL_KEYS = [
  "ebitdaStated",
  "ebitdaComputed",
  "ebitdaVariance",
  "statedEbitda",
  "computedEbitda",
  "variance",
  "tolerance",
  "checks",
] as const;

function serviceErrorResponse(err: unknown, scope: string): NextResponse {
  const rec =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const extra: Record<string, unknown> = {};
  if (rec) {
    for (const [key, value] of Object.entries(rec)) {
      if (
        key === "error" ||
        key === "code" ||
        key === "message" ||
        key === "stack" ||
        key === "name" ||
        key === "cause"
      ) {
        continue;
      }
      extra[key] = value;
    }
    for (const key of ERROR_DETAIL_KEYS) {
      if (extra[key] === undefined && rec[key] !== undefined) {
        extra[key] = rec[key];
      }
    }
  }
  const code =
    rec && typeof rec.error === "string"
      ? rec.error
      : rec && typeof rec.code === "string"
        ? rec.code
        : err instanceof Error && /^[a-z][a-z0-9_]*$/.test(err.message)
          ? err.message
          : "";
  if (code === "posted_immutable" || code === "adjustment_already_decided") {
    return NextResponse.json(
      { error: code, ...extra },
      { status: 409, headers: NO_STORE_HEADERS }
    );
  }
  if (code === "ebitda_override_required") {
    return NextResponse.json(
      { error: code, ...extra },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
  if (code === "not_found" || code.endsWith("_not_found")) {
    return NextResponse.json(
      { error: code, ...extra },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }
  if (code) {
    return NextResponse.json(
      { error: code, ...extra },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
  console.error(
    `[finanalysis] ${scope} failed: ${err instanceof Error ? err.message : "unknown error"}`
  );
  return NextResponse.json(
    { error: "internal" },
    { status: 500, headers: NO_STORE_HEADERS }
  );
}

async function parseJsonBody(
  req: NextRequest
): Promise<{ body: Record<string, unknown>; invalid: boolean }> {
  const text = await req.text().catch(() => "");
  if (!text.trim()) return { body: {}, invalid: false };
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { body: value as Record<string, unknown>, invalid: false };
    }
    return { body: {}, invalid: true };
  } catch {
    return { body: {}, invalid: true };
  }
}

/**
 * POST /api/platform/financials/analysis/adjustments/[id]/decide
 * {decision, amount?, inputValue?}
 * Maps: 'amount_required' 400, 'adjustment_not_found' 404,
 * 'adjustment_already_decided' 409, 'invalid_decision' 400.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { body, invalid } = await parseJsonBody(req);
  if (invalid) {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
  try {
    await ensurePlatform();
    await ensureFinancials();
    await ensureFinanalysis();
    const decision =
      typeof body.decision === "string" ? body.decision : "";
    const amount =
      typeof body.amount === "number" && isFinite(body.amount)
        ? body.amount
        : body.amount === null
          ? null
          : undefined;
    const inputValue =
      typeof body.inputValue === "number" && isFinite(body.inputValue)
        ? body.inputValue
        : body.inputValue === null
          ? null
          : undefined;
    const adjustment = await decideAdjustment(
      params.id,
      { decision, amount, inputValue },
      user.name || user.email
    );
    return NextResponse.json(
      { adjustment },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    return serviceErrorResponse(err, "decideAdjustment");
  }
}
