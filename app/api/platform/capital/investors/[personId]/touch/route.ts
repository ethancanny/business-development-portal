import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/capital/http";
import { touchInvestorProfile } from "@/lib/capital/service";

/** POST log a touch: stamps the investor profile's last_touch_at to
 * now and returns the updated profile. */
export async function POST(
  _req: NextRequest,
  { params }: { params: { personId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const profile = await touchInvestorProfile(
      params.personId,
      gate.user.name || gate.user.email
    );
    return ok({ profile });
  } catch (err) {
    return serviceError(err, "investor-touch");
  }
}
