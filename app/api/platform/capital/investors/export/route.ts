import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { listInvestors } from "@/lib/capital/service";
import {
  exportResponse,
  formatFromParam,
  type TabularColumn,
} from "@/lib/platform/tabular";

/**
 * Capital investors export (Phase 10): listInvestors from
 * lib/capital/service (Directory people tagged investor/lp merged
 * with their capital profile). The service caps its page size at 50,
 * so this pages through it up to the 1000-row export cap. Investor
 * data is internal-only, mirroring the investors list route's gate.
 */

const COLUMNS: TabularColumn[] = [
  { key: "personId", label: "Person ID" },
  { key: "name", label: "Name" },
  { key: "firm", label: "Firm" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "email", label: "Email" },
  { key: "checkMin", label: "Check Min" },
  { key: "checkMax", label: "Check Max" },
  { key: "lastTouch", label: "Last Touch" },
];

const CAP = 1000;
const PAGE = 50;

export async function GET(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "internal_only" }, { status: 403 });
  }
  const format = formatFromParam(req.nextUrl.searchParams.get("format"));
  const rows: Record<string, unknown>[] = [];
  let total = 0;
  for (let offset = 0; offset < CAP; offset += PAGE) {
    const { items, total: t } = await listInvestors({
      q: req.nextUrl.searchParams.get("q") ?? undefined,
      status: req.nextUrl.searchParams.get("status") ?? undefined,
      limit: PAGE,
      offset,
    });
    total = t;
    for (const item of items) {
      rows.push({
        personId: item.personId,
        name: item.name,
        firm: item.firm,
        type: item.profile.investorType || item.types.join("; "),
        status: item.profile.status,
        email: item.email,
        checkMin: item.profile.checkSizeMin,
        checkMax: item.profile.checkSizeMax,
        lastTouch: item.profile.lastTouchAt ?? "",
      });
    }
    if (!items.length || rows.length >= Math.min(total, CAP)) break;
  }
  return exportResponse(
    rows.slice(0, CAP),
    COLUMNS,
    "investors-export",
    format,
    total > CAP
  );
}
