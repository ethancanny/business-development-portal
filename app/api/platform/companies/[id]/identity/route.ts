import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import {
  getIdentity,
  setAccentColor,
  setWebsite,
} from "@/lib/identity/service";
import { normalizeDomain } from "@/lib/identity/fetch";
import { normalizeHex } from "@/lib/identity/shared";

/**
 * Company identity read + the editable non-logo fields (accent
 * color, website domain). Logo bytes go through the logo routes.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const identity = await getIdentity(params.id);
  if (!identity) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }
  return NextResponse.json(
    { identity },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}

export async function PATCH(
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
  try {
    let identity = await getIdentity(params.id);
    if (!identity) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    if (typeof body.accentColor === "string") {
      if (!normalizeHex(body.accentColor)) {
        return NextResponse.json(
          { error: "Accent color must be a #rrggbb hex value" },
          { status: 400 }
        );
      }
      identity = await setAccentColor(params.id, body.accentColor);
    }
    if (typeof body.website === "string") {
      const trimmed = body.website.trim();
      if (trimmed) {
        const domain = normalizeDomain(trimmed);
        if (!domain) {
          return NextResponse.json(
            { error: "Website must be a valid domain or URL" },
            { status: 400 }
          );
        }
        identity = await setWebsite(params.id, `https://${domain}`);
      } else {
        identity = await setWebsite(params.id, "");
      }
    }
    return NextResponse.json({ ok: true, identity });
  } catch (err) {
    return NextResponse.json(
      { error: "update_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
