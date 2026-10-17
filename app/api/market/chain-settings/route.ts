import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getChainFilterSettings,
  setChainFilterSettings,
  countChainStats,
} from "@/lib/market-db";

/**
 * Chain/franchise filter settings (Ethan, Oct 16, 2026): the exclusion
 * list of national chains / franchise brands and the two location
 * thresholds (multi-state / anywhere) are portal SETTINGS, not code —
 * stored in mi_chain_state, edited from the Settings screen. GET
 * returns the settings plus live flag counts; POST validates + saves.
 * Changes take effect on the next detection run (imports judge with
 * the refreshed settings immediately; existing records are re-judged
 * by the detection pass — the Settings card's re-run button, or
 * POST /api/market/chain-detect).
 */
export const maxDuration = 60;

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [settings, stats] = await Promise.all([
      getChainFilterSettings(),
      countChainStats(),
    ]);
    return NextResponse.json({ settings, stats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    brands?: unknown;
    multiStateLocations?: unknown;
    anywhereLocations?: unknown;
  };
  if (!Array.isArray(body.brands)) {
    return NextResponse.json({ error: "brands must be an array of names" }, { status: 400 });
  }
  const multiStateLocations = Number(body.multiStateLocations);
  const anywhereLocations = Number(body.anywhereLocations);
  if (!Number.isFinite(multiStateLocations) || multiStateLocations < 2 || multiStateLocations > 100) {
    return NextResponse.json({ error: "multiStateLocations must be between 2 and 100" }, { status: 400 });
  }
  if (!Number.isFinite(anywhereLocations) || anywhereLocations < 2 || anywhereLocations > 200) {
    return NextResponse.json({ error: "anywhereLocations must be between 2 and 200" }, { status: 400 });
  }
  try {
    const settings = await setChainFilterSettings({
      brands: body.brands.map((b) => String(b)),
      multiStateLocations: Math.round(multiStateLocations),
      anywhereLocations: Math.round(anywhereLocations),
    });
    const stats = await countChainStats();
    return NextResponse.json({ ok: true, settings, stats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
