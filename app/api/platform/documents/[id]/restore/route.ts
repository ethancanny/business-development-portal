import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { restoreDocumentVersion } from "@/lib/dataroom/documents";
import { runDueJobs } from "@/lib/platform/jobs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const version = typeof body.version === "number" ? body.version : 0;
  if (!version) {
    return NextResponse.json({ error: "version is required" }, { status: 400 });
  }
  try {
    const result = await restoreDocumentVersion(
      params.id,
      version,
      user.name || user.email
    );
    if (!result) {
      return NextResponse.json(
        { error: "Document or version not found" },
        { status: 404 }
      );
    }
    await runDueJobs(3).catch(() => 0);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
