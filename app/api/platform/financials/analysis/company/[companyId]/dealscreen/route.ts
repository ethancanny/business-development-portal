import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureFinancials } from "@/lib/financials/schema";
import { ensureFinanalysis } from "@/lib/finanalysis/schema";
import { getCurrentAnalysis } from "@/lib/finanalysis/service";
import { getCompanyFinancials } from "@/lib/financials/service";
import {
  computeDealScreen,
  DEFAULT_DEAL_SCREEN_ASSUMPTIONS,
} from "@/lib/finanalysis/dealscreen";
import type { DealScreenAssumptions } from "@/lib/finanalysis/types";

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

function finiteNumber(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  return null;
}

/**
 * POST /api/platform/financials/analysis/company/[companyId]/dealscreen
 * {assumptions?, ebitdaOverride?, exitMultiple?}
 * Resolves EBITDA: ebitdaOverride (finite) > current analysis
 * marginBridge.adjustedEbitda (basis 'adjusted') > financials summary
 * ttm.ebitda (basis 'ttm-reported') > latest.ebitda (basis 'reported').
 * exitMultiple is accepted for API compatibility; the screen grid and
 * sensitivity cover all exit multiples, so it does not alter the
 * computation. Returns the DealScreenData verbatim.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string } }
) {
  if (!getSessionUser()) {
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

    // Merge assumptions over defaults (only finite numbers override).
    const rawAssumptions =
      body.assumptions &&
      typeof body.assumptions === "object" &&
      !Array.isArray(body.assumptions)
        ? (body.assumptions as Record<string, unknown>)
        : {};
    const assumptions: DealScreenAssumptions = {
      ...DEFAULT_DEAL_SCREEN_ASSUMPTIONS,
    };
    for (const key of [
      "leverageMultiple",
      "feesPct",
      "growthPct",
      "holdYears",
      "debtPaydownPct",
    ] as const) {
      const v = finiteNumber(rawAssumptions[key]);
      if (v !== null) assumptions[key] = v;
    }
    // exitMultiple accepted but not used by computeDealScreen (grid +
    // sensitivity span 4–8x); parsed to validate shape only.
    void finiteNumber(body.exitMultiple);

    const override = finiteNumber(body.ebitdaOverride);
    let ebitda: number | null = null;
    let basis = "reported";
    if (override !== null) {
      ebitda = override;
      basis = "override";
    } else {
      const current = await getCurrentAnalysis(params.companyId);
      const adjusted = current?.payload?.marginBridge?.adjustedEbitda ?? null;
      if (adjusted !== null && isFinite(adjusted)) {
        ebitda = adjusted;
        basis = "adjusted";
      } else {
        const fin = await getCompanyFinancials(params.companyId);
        const ttmEbitda = fin.summary.ttm?.ebitda ?? null;
        if (ttmEbitda !== null && isFinite(ttmEbitda)) {
          ebitda = ttmEbitda;
          basis = "ttm-reported";
        } else {
          const latestEbitda = fin.summary.latest?.ebitda ?? null;
          ebitda =
            latestEbitda !== null && isFinite(latestEbitda)
              ? latestEbitda
              : null;
          basis = "reported";
        }
      }
    }

    const result = computeDealScreen({
      ebitda,
      ebitdaBasis: basis,
      assumptions,
    });
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err) {
    return serviceErrorResponse(err, "dealscreen");
  }
}
