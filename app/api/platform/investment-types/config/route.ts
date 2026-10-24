import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getBdConfig, updateBdConfig } from "@/lib/bd/service";

/** Investment Types configuration (Step 1): GET the live config;
 * PUT a partial patch (Settings → Investment types): type enabled
 * flags (this is the Minority Growth switch), per-type stage lists,
 * metric-definition enabled/label/sort/section, sector packs.
 *
 * Two patch shapes are accepted: the array shape documented on
 * updateBdConfig ({ types: [...], definitions: [...], sectorPacks:
 * [...] }) and the single-item shape the Settings card actually
 * sends ({ kind: "type" | "definition" | "sectorPack", key, ... }).
 * The kind shape is normalized into the array shape here — before
 * Oct 24, 2026 it was silently ignored, so every Settings toggle on
 * this surface appeared to save and did nothing. */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  return NextResponse.json(await getBdConfig());
}

type ConfigPatch = Parameters<typeof updateBdConfig>[0];

function normalizePatch(body: Record<string, unknown>): ConfigPatch {
  const patch: ConfigPatch = {};
  if (Array.isArray(body.types)) patch.types = body.types as ConfigPatch["types"];
  if (Array.isArray(body.definitions))
    patch.definitions = body.definitions as ConfigPatch["definitions"];
  if (Array.isArray(body.sectorPacks))
    patch.sectorPacks = body.sectorPacks as ConfigPatch["sectorPacks"];

  const kind = typeof body.kind === "string" ? body.kind : "";
  const key = typeof body.key === "string" ? body.key : "";
  if (kind && key) {
    if (kind === "type") {
      patch.types = [
        ...(patch.types ?? []),
        {
          key,
          enabled:
            typeof body.enabled === "boolean" ? body.enabled : undefined,
          stages: Array.isArray(body.stages)
            ? body.stages.map((s) => String(s))
            : undefined,
        },
      ];
    } else if (kind === "definition") {
      patch.definitions = [
        ...(patch.definitions ?? []),
        {
          key,
          enabled:
            typeof body.enabled === "boolean" ? body.enabled : undefined,
          label: typeof body.label === "string" ? body.label : undefined,
          sort: typeof body.sort === "number" ? body.sort : undefined,
          section:
            body.section === null
              ? null
              : typeof body.section === "string"
                ? body.section
                : undefined,
        },
      ];
    } else if (kind === "sectorPack") {
      patch.sectorPacks = [
        ...(patch.sectorPacks ?? []),
        {
          key,
          label: typeof body.label === "string" ? body.label : undefined,
          industryMatch:
            typeof body.industryMatch === "string"
              ? body.industryMatch
              : undefined,
          enabled:
            typeof body.enabled === "boolean" ? body.enabled : undefined,
        },
      ];
    }
  }
  return patch;
}

export async function PUT(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const config = await updateBdConfig(
    normalizePatch(body),
    user.name || user.email
  );
  return NextResponse.json(config);
}
