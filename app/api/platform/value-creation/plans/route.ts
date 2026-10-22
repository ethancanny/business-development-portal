import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { createPlan, listPlans } from "@/lib/valuecreation/service";

/** GET list plans (with companyName + summary). POST create {companyId,...}. */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const plans = await listPlans();
    return ok({ plans });
  } catch (err) {
    return serviceError(err, "plans-list");
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const plan = await createPlan(
      {
        companyId: typeof body.companyId === "string" ? body.companyId : "",
        name: typeof body.name === "string" ? body.name : undefined,
        planStartDate:
          typeof body.planStartDate === "string" || body.planStartDate === null
            ? (body.planStartDate as string | null)
            : undefined,
        thesis: typeof body.thesis === "string" ? body.thesis : undefined,
      },
      gate.user.name
    );
    return ok({ plan }, 201);
  } catch (err) {
    return serviceError(err, "plan-create");
  }
}
