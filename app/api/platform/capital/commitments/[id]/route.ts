import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  ok,
  readBody,
  serviceError,
  sStr,
  sNum,
  sDate,
} from "@/lib/capital/http";
import {
  deleteCommitment,
  updateCommitment,
} from "@/lib/capital/service";

/** PATCH a commitment (amount / kind / stage / notes / investor). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const commitment = await updateCommitment(
      params.id,
      {
        investorPersonId: sStr(body.investorPersonId),
        amount: sNum(body.amount),
        kind: sStr(body.kind),
        stage: sStr(body.stage),
        notes: sStr(body.notes),
        pipelineStage: sStr(body.pipelineStage),
        indicatedAmount: sNum(body.indicatedAmount),
        softAmount: sNum(body.softAmount),
        hardAmount: sNum(body.hardAmount),
        fundedAmount: sNum(body.fundedAmount),
        owner: sStr(body.owner),
        docStatus: sStr(body.docStatus),
        wireStatus: sStr(body.wireStatus),
        expectedFundingDate: sDate(body.expectedFundingDate),
      },
      gate.user.name || gate.user.email
    );
    return ok({ commitment });
  } catch (err) {
    return serviceError(err, "commitment-update");
  }
}

/** DELETE soft-deletes a commitment. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteCommitment(
      params.id,
      gate.user.name || gate.user.email
    );
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "commitment-delete");
  }
}
