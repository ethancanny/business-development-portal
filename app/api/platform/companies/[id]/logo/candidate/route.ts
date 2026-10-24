import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { guardedFetch, verifyCandidateToken } from "@/lib/identity/fetch";
import { detectLogoMime, extractIcoPng } from "@/lib/identity/logo";

export const runtime = "nodejs";

/**
 * Preview proxy for auto-fetch candidates. The `t` parameter is an
 * HMAC-signed token minted by fetch-candidates — the raw URL never
 * travels through the client, and this route will only fetch a URL
 * we signed. Response is the candidate's raw bytes (image only) so
 * the picker can render it. Nothing is stored.
 */
export async function GET(
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
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const url = verifyCandidateToken(token);
  if (!url) {
    return NextResponse.json({ error: "Bad candidate token" }, { status: 400 });
  }
  try {
    const fetched = await guardedFetch(url, { accept: "image/*" });
    const png = extractIcoPng(fetched.data);
    const data = png ?? fetched.data;
    const mime =
      detectLogoMime(data) ??
      (fetched.contentType.startsWith("image/") ? fetched.contentType : null);
    if (!mime) {
      return NextResponse.json(
        { error: "Candidate is not a supported image" },
        { status: 415 }
      );
    }
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=600",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "candidate_unreachable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
