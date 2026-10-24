import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { clearLogo, getIdentity, setLogo } from "@/lib/identity/service";
import { MAX_LOGO_BYTES } from "@/lib/identity/logo";

export const runtime = "nodejs";

/**
 * Logo upload (multipart, field "file"; PNG / JPG / SVG, ≤2 MB) and
 * removal for a company or Directory organization. Manual upload
 * always wins: it stores a new version regardless of what a previous
 * auto-fetch saved. Processing (metadata strip, renditions, dominant
 * color) happens in lib/identity/logo.ts via the identity service.
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
  const existing = await getIdentity(params.id);
  if (!existing) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  const bytes = Buffer.from(await (file as File).arrayBuffer());
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", detail: "Logos are capped at 2 MB." },
      { status: 400 }
    );
  }
  try {
    const identity = await setLogo(params.id, bytes, "upload");
    return NextResponse.json({ ok: true, identity });
  } catch (err) {
    return NextResponse.json(
      { error: "logo_rejected", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
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
  try {
    const identity = await clearLogo(params.id);
    return NextResponse.json({ ok: true, identity });
  } catch (err) {
    return NextResponse.json(
      { error: "not_found", detail: err instanceof Error ? err.message : String(err) },
      { status: 404 }
    );
  }
}
