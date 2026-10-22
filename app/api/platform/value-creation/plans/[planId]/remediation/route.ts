import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import {
  convertRemediation,
  listRemediationCandidates,
} from "@/lib/valuecreation/service";

/** GET low-scoring diligence scorecard areas for this plan's company. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const candidates = await listRemediationCandidates(params.planId);
    return ok({ candidates });
  } catch (err) {
    return serviceError(err, "remediation-list");
  }
}

/** POST {workspaceId, areaKey, ownerName?, dueDate?} — convert to an initiative. */
export async function POST(
  req: NextRequest,
  { params }: { params: { planId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const initiative = await convertRemediation(
      params.planId,
      {
        workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : "",
        areaKey: typeof body.areaKey === "string" ? body.areaKey : "",
        ownerName: typeof body.ownerName === "string" ? body.ownerName : undefined,
        dueDate:
          typeof body.dueDate === "string" || body.dueDate === null
            ? (body.dueDate as string | null)
            : undefined,
      },
      gate.user.name
    );
    return ok({ initiative }, 201);
  } catch (err) {
    return serviceError(err, "remediation-convert");
  }
}
