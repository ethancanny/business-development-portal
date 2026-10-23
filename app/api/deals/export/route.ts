import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDeals } from "@/lib/db";
import {
  DEAL_COLUMNS,
  exportResponse,
  formatFromParam,
} from "@/lib/platform/tabular";

/** Deals export (Phase 10): the pipeline grid as CSV/XLSX.
 * Columns (lib/platform/tabular DEAL_COLUMNS) are shared with the
 * deals import so an exported file round-trips. */

const CAP = 5000;

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const format = formatFromParam(req.nextUrl.searchParams.get("format"));
  const deals = await getDeals();
  const truncated = deals.length > CAP;
  const rows = deals
    .slice(0, CAP)
    .map((d) => ({ ...d }) as unknown as Record<string, unknown>);
  return exportResponse(rows, DEAL_COLUMNS, "deals-export", format, truncated);
}
