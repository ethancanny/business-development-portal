import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getBdConfig, updateBdConfig } from "@/lib/bd/service";

/** Investment Types configuration (Step 1): GET the live config;
 * PUT a partial patch (Settings → Investment types): type enabled
 * flags (this is the Minority Growth switch), per-type stage lists,
 * metric-definition enabled/label/sort, sector packs. */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  return NextResponse.json(await getBdConfig());
}

export async function PUT(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as {
    types?: Array<{ key: string; enabled?: boolean; stages?: string[] }>;
    definitions?: Array<{ key: string; enabled?: boolean; label?: string; sort?: number }>;
    sectorPacks?: Array<{ key: string; label?: string; industryMatch?: string; enabled?: boolean }>;
  };
  const config = await updateBdConfig(body, user.name || user.email);
  return NextResponse.json(config);
}
