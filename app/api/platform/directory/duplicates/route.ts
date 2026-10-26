import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { normalizeEntityKind } from "@/lib/directory/service";
import { ensureCrm, findDirectoryDuplicates } from "@/lib/directory/crm";

/**
 * CRM Phase 1 — duplicate detection. GET ?kind=person|organization;
 * with no kind, both kinds are scanned and pairs carry their kind.
 */

export async function GET(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "internal_only" }, { status: 403 });
  }
  await ensurePlatform();
  await ensureDirectory();
  await ensureCrm();
  const kindRaw = req.nextUrl.searchParams.get("kind");
  if (kindRaw) {
    const kind = normalizeEntityKind(kindRaw);
    if (!kind) {
      return NextResponse.json(
        { error: "kind must be 'person' or 'organization'" },
        { status: 400 }
      );
    }
    const pairs = await findDirectoryDuplicates(kind);
    return NextResponse.json(
      { pairs, items: pairs },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  }
  const [people, orgs] = await Promise.all([
    findDirectoryDuplicates("person"),
    findDirectoryDuplicates("organization"),
  ]);
  const pairs = [...people, ...orgs];
  return NextResponse.json(
    { pairs, items: pairs },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
