import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getHospitalityFitSettings,
  setHospitalityFitSettings,
  getHospitalityMeta,
} from "@/lib/hospitality-ingest";
import {
  refreshHospitalityThresholds,
  rescoreCompanies,
  countFits,
} from "@/lib/market-db";

/**
 * Hospitality fit settings + spine meta (hospitality build §2,
 * Oct 15, 2026). GET returns the editable fit thresholds and the
 * spine's source list / counts / last-updated stamp — the Overview
 * Sector tile and the Fit Targets Hospitality tab read it for their
 * source + data-date lines. POST saves new thresholds and immediately
 * re-judges the Hospitality companies so the change takes effect
 * without waiting for the next ingest.
 */
export const maxDuration = 60;

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [settings, meta] = await Promise.all([
      getHospitalityFitSettings(),
      getHospitalityMeta(),
    ]);
    return NextResponse.json({ settings, meta });
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
    minLocations?: unknown;
    hotelMinRevenue?: unknown;
  };
  const minLocations = Number(body.minLocations);
  const hotelMinRevenue = Number(body.hotelMinRevenue);
  if (!Number.isFinite(minLocations) || minLocations < 1 || minLocations > 50) {
    return NextResponse.json({ error: "minLocations must be between 1 and 50" }, { status: 400 });
  }
  if (!Number.isFinite(hotelMinRevenue) || hotelMinRevenue < 100_000 || hotelMinRevenue > 50_000_000) {
    return NextResponse.json({ error: "hotelMinRevenue must be between $100K and $50M" }, { status: 400 });
  }
  try {
    const settings = await setHospitalityFitSettings({
      minLocations: Math.round(minLocations),
      hotelMinRevenue: Math.round(hotelMinRevenue),
    });
    // Re-judge existing Hospitality rows under the new thresholds.
    await refreshHospitalityThresholds(true);
    let offset = 0;
    for (let page = 0; page < 40; page++) {
      const r = await rescoreCompanies("Hospitality", offset);
      if (r.nextOffset === -1) break;
      offset = r.nextOffset;
    }
    const fitTotal = await countFits("Hospitality");
    return NextResponse.json({ ok: true, settings, fitTotal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
