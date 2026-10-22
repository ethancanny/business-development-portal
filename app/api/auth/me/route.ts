import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getUserRole, getUserScope } from "@/lib/platform/permissions";

export async function GET() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Phase 9 (additive): role + company scope resolved from
  // core.user_roles. admin/internal → companyIds null (unrestricted);
  // guests → their stored companyIds (falling back to the session
  // token's claims when the DB scope carries none).
  const role = await getUserRole(user.email);
  let companyIds: string[] | null = null;
  if (role === "guest") {
    const scope = await getUserScope(user.email);
    if (Array.isArray(scope.companyIds)) {
      companyIds = scope.companyIds.map((x) => String(x)).filter(Boolean);
    } else if (Array.isArray(user.companyIds)) {
      companyIds = user.companyIds.map((x) => String(x)).filter(Boolean);
    } else {
      companyIds = [];
    }
  }
  return NextResponse.json({ user: { ...user, role, companyIds } });
}
