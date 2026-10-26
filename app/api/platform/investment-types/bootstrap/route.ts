import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getBdBootstrap } from "@/lib/bd/service";
import { datasetVersionHeader } from "@/lib/platform/versions";

/** Investment Types bootstrap (Step 1, Oct 23, 2026): type/stage
 * config + metric definitions + sector packs + every deal's metric
 * values + sourced-from options, in one bounded payload for the
 * pipeline surfaces. Session-gated; private short cache. */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const data = await getBdBootstrap();
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "private, max-age=60",
      ...(await datasetVersionHeader("bd_bootstrap")),
    },
  });
}
