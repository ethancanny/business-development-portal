import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getDatasetVersions } from "@/lib/platform/versions";

/**
 * Dataset versions map (Performance Fix Pass, DESIGN.md §1):
 * clients poll this cheap map and skip payload fetches for datasets
 * whose version has not moved. Session-gated; never cached.
 * Supports ?datasets=a,b to return only those datasets.
 */
export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const all = await getDatasetVersions();
  const filter = (req.nextUrl.searchParams.get("datasets") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const versions: Record<string, number> = {};
  if (filter.length) {
    for (const name of filter) {
      if (name in all) versions[name] = all[name];
    }
  } else {
    Object.assign(versions, all);
  }
  return NextResponse.json(
    { versions },
    { headers: { "Cache-Control": "private, no-cache" } }
  );
}
