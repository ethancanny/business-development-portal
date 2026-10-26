import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/capital/http";
import { getMatchingMatrix } from "@/lib/capital/service";
import { datasetVersionHeader } from "@/lib/platform/versions";

/** GET the cross-raise matching matrix: investors × open raises with
 * per-cell stage/exposure, per-investor capacity, and the top-3
 * suggested matches per raise. ?type=<typeKey>&limit=&offset= */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const sp = req.nextUrl.searchParams;
    const limitRaw = Number(sp.get("limit") ?? 50);
    const offsetRaw = Number(sp.get("offset") ?? 0);
    const matrix = await getMatchingMatrix({
      typeKey: sp.get("type") ?? undefined,
      limit: isFinite(limitRaw) ? limitRaw : 50,
      offset: isFinite(offsetRaw) ? offsetRaw : 0,
    });
    const res = ok(matrix);
    const hdr = await datasetVersionHeader("capital");
    if (hdr["X-Dataset-Version"]) res.headers.set("X-Dataset-Version", hdr["X-Dataset-Version"]);
    return res;
  } catch (err) {
    return serviceError(err, "matching-matrix");
  }
}
