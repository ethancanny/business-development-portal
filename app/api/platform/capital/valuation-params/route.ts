import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/capital/http";
import {
  getValuationParams,
  updateValuationParams,
  VALUATION_NUMERIC_KEYS,
  type ValuationNumericKey,
} from "@/lib/capital/service";

/** GET the global valuation params (camelCase). */
export async function GET(): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const params = await getValuationParams();
    return ok({ params });
  } catch (err) {
    return serviceError(err, "valuation-params-get");
  }
}

/** PUT valuation params (partial; all numerics ≥ 0, low ≤ high). */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const patch: Partial<Record<ValuationNumericKey, number>> = {};
    for (const key of VALUATION_NUMERIC_KEYS) {
      if (typeof body[key] === "number") patch[key] = body[key] as number;
    }
    const params = await updateValuationParams(
      patch,
      gate.user.name || gate.user.email
    );
    return ok({ params });
  } catch (err) {
    return serviceError(err, "valuation-params-update");
  }
}
