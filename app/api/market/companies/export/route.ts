import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getCompanies, getFitCompanies, countCompanies } from "@/lib/market-db";
import {
  exportResponse,
  formatFromParam,
  type TabularColumn,
} from "@/lib/platform/tabular";

/**
 * Market Intel companies export (Phase 10): mi_companies via
 * lib/market-db. Default = getCompanies (optional ?sector=).
 * ?mode=fits switches to the Fit Targets feed (getFitCompanies —
 * status='fit', chain/institutional excluded) and accepts a
 * comma-separated ?sector= list. mi_companies carries no revenue or
 * employee estimate columns of its own: revenueEstimate is parsed
 * from the details JSON (the enrichment stamp computeFit reads) and
 * employees is the row's own column.
 */

const COLUMNS: TabularColumn[] = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "sector", label: "Sector" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "status", label: "Status" },
  { key: "revenueEstimate", label: "Revenue Estimate" },
  { key: "employees", label: "Employees" },
  { key: "dateAdded", label: "Date Added" },
];

const CAP = 5000;
const PAGE = 1000;

function revenueEstimateOf(details: string): number | null {
  try {
    const d = JSON.parse(details || "{}") as Record<string, unknown>;
    return typeof d.revenueEstimate === "number" ? d.revenueEstimate : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const format = formatFromParam(req.nextUrl.searchParams.get("format"));
  const sp = req.nextUrl.searchParams;
  const mode = (sp.get("mode") ?? "").toLowerCase();

  type Row = {
    id: string;
    name: string;
    sector: string;
    city: string;
    state: string;
    status: string;
    employees: number | null;
    details: string;
    dateAdded: string;
  };
  let companies: Row[] = [];
  let truncated = false;

  if (mode === "fits") {
    const sectors = (sp.get("sector") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const { companies: fits, fitTotal } = await getFitCompanies(
      sectors.length ? sectors : undefined
    );
    companies = fits;
    // getFitCompanies caps its own feed at FITS_DISPLAY_LIMIT — the
    // export is that feed, so flag truncation against the true total.
    truncated = fitTotal > fits.length;
  } else {
    const sector = sp.get("sector") ?? undefined;
    const total = await countCompanies(sector);
    truncated = total > CAP;
    for (let offset = 0; offset < CAP; offset += PAGE) {
      const page = await getCompanies(sector, PAGE, offset);
      companies.push(...page);
      if (!page.length || companies.length >= Math.min(total, CAP)) break;
    }
    companies = companies.slice(0, CAP);
  }

  const rows: Record<string, unknown>[] = companies.map((c) => ({
    id: c.id,
    name: c.name,
    sector: c.sector,
    city: c.city,
    state: c.state,
    status: c.status,
    revenueEstimate: revenueEstimateOf(c.details),
    employees: c.employees,
    dateAdded: c.dateAdded,
  }));
  return exportResponse(
    rows,
    COLUMNS,
    "market-companies-export",
    format,
    truncated
  );
}
