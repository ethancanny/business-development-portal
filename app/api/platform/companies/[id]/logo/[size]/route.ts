import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getLogoObject } from "@/lib/identity/service";
import { LOGO_SIZES } from "@/lib/identity/shared";

export const runtime = "nodejs";

/**
 * Serve a stored logo rendition. The URL carries the logo version,
 * so responses are immutable and long-cached (the portal's CDN layer
 * caches them at the edge). Bytes come from object storage via the
 * identity service — never from the database.
 *
 * Auth: any session may load marks for companies it can reach —
 * partner sessions reach everything; Phase 9 guest (company-scoped)
 * sessions only their own companies. Codename-external surfaces never
 * reference this route at all (the resolver hides the mark first).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; size: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    user.role === "guest" &&
    Array.isArray(user.companyIds) &&
    !user.companyIds.includes(params.id)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await ensurePlatform();
  const size =
    params.size === "original"
      ? "original"
      : (LOGO_SIZES.find((s) => String(s) === params.size) ?? null);
  if (size === null) {
    return NextResponse.json({ error: "Unknown size" }, { status: 404 });
  }
  const obj = await getLogoObject(params.id, size);
  if (!obj) {
    return NextResponse.json({ error: "No logo" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(obj.data), {
    headers: {
      "Content-Type": obj.mime,
      "Content-Length": String(obj.data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
