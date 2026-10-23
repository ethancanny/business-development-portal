import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/comms/http";
import { diffVersions, getReport } from "@/lib/comms/service";

/** GET ?from=&to= — structural diff between two report versions
 *  (lib/comms/service diffVersions(reportId, from, to): block /
 *  figure / narrative changes). Defaults: from v1, to current. */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const detail = await getReport(params.id);
    const current = detail?.currentVersion || 1;
    const sp = req.nextUrl.searchParams;
    const fromRaw = Number(sp.get("from") ?? 1);
    const toRaw = Number(sp.get("to") ?? current);
    const from = Number.isFinite(fromRaw) ? fromRaw : 1;
    const to = Number.isFinite(toRaw) ? toRaw : current;
    const { changes } = await diffVersions(params.id, from, to);
    return ok({ changes, from, to });
  } catch (err) {
    return serviceError(err, "report-diff");
  }
}
