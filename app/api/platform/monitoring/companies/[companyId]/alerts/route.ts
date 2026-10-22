import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/monitoring/http";
import { listCompanyAlerts } from "@/lib/monitoring/analytics";

/** GET the company's monitoring alerts (WS-A's listAlerts;
 * ?status=open|acked|resolved, ?limit=&offset=). */
export async function GET(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const sp = req.nextUrl.searchParams;
    const limitRaw = Number(sp.get("limit") ?? 50);
    const offsetRaw = Number(sp.get("offset") ?? 0);
    const result = await listCompanyAlerts(params.companyId, {
      status: sp.get("status") ?? undefined,
      limit: isFinite(limitRaw) ? limitRaw : 50,
      offset: isFinite(offsetRaw) ? offsetRaw : 0,
    });
    return ok(result);
  } catch (err) {
    return serviceError(err, "alerts-get");
  }
}
