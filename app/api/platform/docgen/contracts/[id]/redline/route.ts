import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { DocGenError } from "@/lib/docgen/generate";
import { addRedlineVersion } from "@/lib/docgen/contracts";

/** Upload a counterparty redline (multipart, field "file", optional
 * "note") — becomes the contract's new current version. */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  const filename = (file as File).name || "redline";
  const mime = (file as File).type || "application/octet-stream";
  const bytes = Buffer.from(await (file as File).arrayBuffer());
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) {
    return NextResponse.json(
      { error: "file_size_invalid" },
      { status: 400 }
    );
  }
  const note =
    typeof form?.get("note") === "string"
      ? (form.get("note") as string)
      : undefined;
  try {
    const result = await addRedlineVersion(
      params.id,
      { bytes, filename, mime, note },
      user.name || user.email
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof DocGenError) {
      const status = err.error === "contract_not_found" ? 404 : 400;
      return NextResponse.json({ error: err.error }, { status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
