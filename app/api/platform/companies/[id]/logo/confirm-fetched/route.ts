import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { setLogo, setWebsite } from "@/lib/identity/service";
import {
  guardedFetch,
  normalizeDomain,
  verifyCandidateToken,
} from "@/lib/identity/fetch";

export const runtime = "nodejs";

/**
 * Auto-fetch step 2 — the ONLY step that writes. Ethan picked a
 * candidate in the picker; the server re-fetches the signed URL
 * itself (never trusting client-supplied bytes), processes it
 * through the standard ingest pipeline, and stores it with source
 * "fetched". When the request carries the domain Ethan confirmed or
 * corrected in the dialog, it is saved to the company record so the
 * next fetch starts from the right place.
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
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  const url = verifyCandidateToken(token);
  if (!url) {
    return NextResponse.json({ error: "Bad candidate token" }, { status: 400 });
  }
  try {
    const fetched = await guardedFetch(url, { accept: "image/*" });
    const identity = await setLogo(params.id, fetched.data, "fetched");
    if (typeof body.domain === "string" && body.domain.trim()) {
      const domain = normalizeDomain(body.domain);
      if (domain) {
        const withSite = await setWebsite(params.id, `https://${domain}`);
        return NextResponse.json({ ok: true, identity: withSite });
      }
    }
    return NextResponse.json({ ok: true, identity });
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
