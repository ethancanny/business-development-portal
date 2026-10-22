import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/valuecreation/http";
import { setDependencies } from "@/lib/valuecreation/service";

/** PUT {dependsOnIds} — replace the initiative's dependency set. */
export async function PUT(
  req: NextRequest,
  { params }: { params: { initiativeId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const dependsOnIds = Array.isArray(body.dependsOnIds)
      ? body.dependsOnIds.filter((x): x is string => typeof x === "string")
      : [];
    const initiative = await setDependencies(
      params.initiativeId,
      dependsOnIds,
      gate.user.name
    );
    return ok({ initiative });
  } catch (err) {
    return serviceError(err, "initiative-dependencies");
  }
}
