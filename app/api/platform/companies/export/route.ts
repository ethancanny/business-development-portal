import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  ensurePlatform,
  listCompanies,
  countCompanies,
} from "@/lib/platform/service";
import {
  exportResponse,
  formatFromParam,
  type TabularColumn,
} from "@/lib/platform/tabular";

/**
 * Platform companies export (Phase 10): core.companies via the same
 * service the companies grid reads (listCompanies, paginated at ≤50
 * per call — paged through here up to the cap). Row shape is
 * CompanyCard, so `sector/industry` maps to its `vertical` and
 * `createdAt` is not on the card — lastActivityAt is exported as
 * "Last Activity" instead (no fabricated creation date).
 */

const COLUMNS: TabularColumn[] = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "vertical", label: "Sector" },
  { key: "stage", label: "Stage" },
  { key: "dealStage", label: "Deal Stage" },
  { key: "ownerContext", label: "Owner" },
  { key: "lastActivityAt", label: "Last Activity" },
];

const CAP = 5000;
const PAGE = 50;

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const format = formatFromParam(req.nextUrl.searchParams.get("format"));
  const filters = {
    stage: req.nextUrl.searchParams.get("stage") ?? undefined,
    vertical: req.nextUrl.searchParams.get("vertical") ?? undefined,
    q: req.nextUrl.searchParams.get("q") ?? undefined,
  };
  const total = await countCompanies(filters);
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < CAP; offset += PAGE) {
    const page = await listCompanies({ ...filters, limit: PAGE, offset });
    rows.push(
      ...page.map((c) => ({ ...c }) as unknown as Record<string, unknown>)
    );
    if (!page.length || rows.length >= Math.min(total, CAP)) break;
  }
  return exportResponse(
    rows.slice(0, CAP),
    COLUMNS,
    "companies-export",
    format,
    total > CAP
  );
}
