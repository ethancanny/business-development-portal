import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import {
  createSnapshot,
  listLatestChecks,
} from "@/lib/diligence/records";

/**
 * Public-record checks for a company.
 * GET  /api/platform/diligence/records?companyId= — latest snapshot per
 *      check type + refresh-due flags + check-type metadata.
 * POST /api/platform/diligence/records — record a manual snapshot
 *      (route defaults to 'manual'; 'automated' is accepted only for
 *      internal callers that pass it explicitly).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const companyId = req.nextUrl.searchParams.get("companyId") ?? "";
    if (!companyId) return ok({ error: "company_required" }, 400);
    const entries = await listLatestChecks(companyId);
    // Flatten the check-type metadata into each entry — the register
    // UI (and the Part 5B API contract) reads key/label/defaultSource/
    // automation/automationNote at the entry level.
    const types = entries.map((e) => ({
      ...e.meta,
      latest: e.latest,
      refreshDue: e.refreshDue,
    }));
    return ok({ types });
  } catch (err) {
    return serviceError(err, "records-latest");
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    const snapshot = await createSnapshot(
      {
        companyId: s(body.companyId),
        dealId: typeof body.dealId === "string" ? body.dealId : null,
        workspaceId:
          typeof body.workspaceId === "string" ? body.workspaceId : null,
        checkType: s(body.checkType),
        sourceName: s(body.sourceName),
        sourceUrl: s(body.sourceUrl),
        route: body.route === "automated" ? "automated" : "manual",
        resultStatus: s(body.resultStatus),
        summary: s(body.summary),
        details:
          body.details && typeof body.details === "object"
            ? (body.details as Record<string, unknown>)
            : undefined,
      },
      gate.user.name
    );
    return ok({ snapshot }, 201);
  } catch (err) {
    return serviceError(err, "records-create");
  }
}
