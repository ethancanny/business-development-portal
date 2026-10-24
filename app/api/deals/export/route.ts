import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDeals } from "@/lib/db";
import {
  DEAL_COLUMNS,
  exportResponse,
  formatFromParam,
} from "@/lib/platform/tabular";
import { parseInvestmentType } from "@/lib/bd/service";

/** Deals export (Phase 10; Investment Types Step 1, Oct 23, 2026).
 * Default: the full pipeline grid (DEAL_COLUMNS, shared with import so
 * files round-trip). ?type=<key> filters to one investment type and
 * uses that type's column set — base grid + type columns + the type's
 * structured-metric columns (bd.deal_metrics values inlined).
 * ?template=1&type=<key> returns the same column set with no rows:
 * the per-type import template. */

const CAP = 5000;

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const format = formatFromParam(req.nextUrl.searchParams.get("format"));
  const typeKey = parseInvestmentType(req.nextUrl.searchParams.get("type"));
  const template = req.nextUrl.searchParams.get("template") === "1";

  if (typeKey) {
    const { buildDealExport, dealTypeColumns, getBdConfig } = await import(
      "@/lib/bd/service"
    );
    if (template) {
      const cfg = await getBdConfig();
      return exportResponse(
        [],
        dealTypeColumns(cfg, typeKey),
        `deals-template-${typeKey}`,
        format,
        false
      );
    }
    const { columns, rows } = await buildDealExport(typeKey);
    const truncated = rows.length > CAP;
    return exportResponse(
      rows.slice(0, CAP),
      columns,
      `deals-${typeKey}`,
      format,
      truncated
    );
  }

  const deals = await getDeals();
  const truncated = deals.length > CAP;
  const rows = deals
    .slice(0, CAP)
    .map((d) => ({ ...d }) as unknown as Record<string, unknown>);
  return exportResponse(rows, DEAL_COLUMNS, "deals-export", format, truncated);
}
