import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { buildInvestorUpdate } from "@/lib/monitoring/exports";
import { companyGate } from "@/lib/monitoring/http";
import { getAccessContext } from "@/lib/platform/permissions";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

/**
 * GET /api/platform/monitoring/companies/[companyId]/export/investor-update?format=pdf|xlsx
 * Investor update download (baseline + latest KPIs + variance +
 * covenants + VC progress + cash; no internal open-alert detail),
 * assembled in lib/monitoring/exports.ts from the monitoring
 * service/analytics getters only. Session-gated; 404 when the company
 * is not a live portfolio company.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { companyId: string } }
) {
  const sessionUser = getSessionUser();
  if (!sessionUser) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }
  try {
    await ensurePlatform();
    const forbidden = companyGate(
      await getAccessContext(sessionUser),
      params.companyId
    );
    if (forbidden) return forbidden;
    const formatRaw = (req.nextUrl.searchParams.get("format") ?? "pdf").toLowerCase();
    if (formatRaw !== "pdf" && formatRaw !== "xlsx") {
      return NextResponse.json(
        { error: "format must be pdf or xlsx" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    const result = await buildInvestorUpdate(params.companyId, formatRaw);
    const body = new Uint8Array(result.bytes as unknown as Uint8Array);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "Content-Length": String(body.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.endsWith("_not_found")) {
      return NextResponse.json(
        { error: "portfolio_company_not_found" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    console.error(
      "[monitoring] investor-update export failed:",
      err instanceof Error ? err.message : "unknown error"
    );
    return NextResponse.json(
      { error: "internal" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
