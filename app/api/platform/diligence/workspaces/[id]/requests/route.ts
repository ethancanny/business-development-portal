import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/diligence/http";
import {
  generateRequests,
  listRequestItems,
  listRequestSends,
} from "@/lib/diligence/service";

/** GET — current request items + send history (no regeneration). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const [items, sends] = await Promise.all([
      listRequestItems(params.id),
      listRequestSends(params.id),
    ]);
    return ok({ items, sends });
  } catch (err) {
    return serviceError(err, "requests-list");
  }
}

/** POST — (re)generate the request list from data room status. */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const result = await generateRequests(params.id);
    return ok(result);
  } catch (err) {
    return serviceError(err, "requests-generate");
  }
}
