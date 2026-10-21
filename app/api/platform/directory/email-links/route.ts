import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { createEmailLink, listEmailLinks } from "@/lib/directory/service";

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDirectory();
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? 25);
  const offsetRaw = Number(sp.get("offset") ?? 0);
  const { items, total } = await listEmailLinks({
    personId: sp.get("personId") ?? sp.get("person_id") ?? undefined,
    organizationId:
      sp.get("organizationId") ?? sp.get("organization_id") ?? undefined,
    companyId: sp.get("companyId") ?? sp.get("company_id") ?? undefined,
    limit: Math.min(50, Math.max(1, isFinite(limitRaw) ? limitRaw : 25)),
    offset: Math.max(0, isFinite(offsetRaw) ? offsetRaw : 0),
  });
  return NextResponse.json(
    { items, emailLinks: items, total },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDirectory();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const emailLink = await createEmailLink({
    ...body,
    createdBy:
      typeof body.createdBy === "string"
        ? body.createdBy
        : user.name || user.email,
    actor: user.name || user.email,
  });
  return NextResponse.json({ emailLink, item: emailLink }, { status: 201 });
}
