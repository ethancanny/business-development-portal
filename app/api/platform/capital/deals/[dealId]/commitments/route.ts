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
  createCommitment,
  listCommitments,
} from "@/lib/capital/service";

/** GET the deal's live commitments (joined to live raises). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const commitments = await listCommitments(params.dealId);
    return ok({ commitments });
  } catch (err) {
    return serviceError(err, "commitments-list");
  }
}

/** POST a commitment against the deal's live open raise. */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const commitment = await createCommitment(
      params.dealId,
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
    return ok({ commitment }, 201);
  } catch (err) {
    return serviceError(err, "commitment-create");
  }
}
