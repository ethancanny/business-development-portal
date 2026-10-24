import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getIdentity } from "@/lib/identity/service";
import {
  discoverLogoCandidates,
  normalizeDomain,
} from "@/lib/identity/fetch";

export const runtime = "nodejs";

/**
 * Auto-fetch step 1: gather logo candidates from the company's
 * website domain. NOTHING is saved here — the response carries only
 * signed candidate tokens + labels; previews render through the
 * signed proxy route, and a separate confirm step stores the chosen
 * candidate. The domain comes from the request body when Ethan
 * enters/corrects it, else from the company record (falling back to
 * its linked MI record / deal website is the client's job — the
 * record's website field is authoritative once set).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role === "guest") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await ensurePlatform();
  const identity = await getIdentity(params.id);
  if (!identity) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const rawDomain =
    typeof body.domain === "string" && body.domain.trim()
      ? body.domain
      : identity.website;
  const domain = normalizeDomain(rawDomain ?? "");
  if (!domain) {
    return NextResponse.json(
      {
        error: "domain_required",
        detail: "No website domain on record — enter the company's domain.",
      },
      { status: 400 }
    );
  }
  try {
    const candidates = await discoverLogoCandidates(domain);
    return NextResponse.json({ ok: true, domain, candidates });
  } catch (err) {
    return NextResponse.json(
      {
        error: "fetch_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
