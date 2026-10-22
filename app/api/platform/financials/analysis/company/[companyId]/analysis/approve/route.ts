import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureFinancials } from "@/lib/financials/schema";
import { ensureFinanalysis } from "@/lib/finanalysis/schema";
import { approveAnalysis } from "@/lib/finanalysis/service";

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
  if (code === "posted_immutable") {
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
 * POST /api/platform/financials/analysis/company/[companyId]/analysis/approve {analysisId}
 * Approves an analysis for publication. 404 'analysis_not_found' when missing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string } }
) {
  void params;
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
    const analysisId =
      typeof body.analysisId === "string" ? body.analysisId.trim() : "";
    if (!analysisId) {
      return NextResponse.json(
        { error: "analysis_id_required" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    const analysis = await approveAnalysis(
      analysisId,
      user.name || user.email
    );
    // Part 5B: an approved analysis refreshes the deal's risk score
    // and IC memo draft (background jobs, best-effort — approval
    // success stands regardless).
    try {
      const cid =
        (analysis as { companyId?: string }).companyId || params.companyId;
      if (cid) {
        const { enqueueRiskAndMemoForCompany } = await import(
          "@/lib/diligence/risk"
        );
        await enqueueRiskAndMemoForCompany(cid, user.name || user.email);
      }
    } catch {
      /* automation is additive */
    }
    return NextResponse.json({ analysis }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    return serviceErrorResponse(err, "approveAnalysis");
  }
}
