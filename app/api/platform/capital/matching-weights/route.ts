import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/capital/http";
import {
  getMatchingWeights,
  updateMatchingWeights,
  type MatchingWeights,
} from "@/lib/capital/service";

const KEYS: Array<keyof MatchingWeights> = [
  "type",
  "checkSize",
  "sector",
  "structure",
  "geography",
  "activity",
];

/** GET the global investor↔raise matching weights. */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const weights = await getMatchingWeights();
    return ok({ weights });
  } catch (err) {
    return serviceError(err, "matching-weights-get");
  }
}

/** PUT matching weights (partial; accepts { weights: {...} } or a
 * flat body of the six numeric keys). */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const src =
      body.weights && typeof body.weights === "object"
        ? (body.weights as Record<string, unknown>)
        : body;
    const patch: Partial<MatchingWeights> = {};
    for (const key of KEYS) {
      if (typeof src[key] === "number") patch[key] = src[key] as number;
    }
    const weights = await updateMatchingWeights(
      patch,
      gate.user.name || gate.user.email
    );
    return ok({ weights });
  } catch (err) {
    return serviceError(err, "matching-weights-update");
  }
}
