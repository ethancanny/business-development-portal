import { NextRequest, NextResponse } from "next/server";
import { rescoreCompanies } from "@/lib/market-db";
import { getSessionUser } from "@/lib/auth";

/**
 * Re-apply the fit rules to existing company rows after a rule change
 * (paged + resumable so it fits the serverless time cap). Session or
 * CRON_SECRET bearer, same as the ingest route.
 * POST /api/market/rescore?sector=<sector>&offset=<n>
 */
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  if (getSessionUser()) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sector = req.nextUrl.searchParams.get("sector") ?? undefined;
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? 0);
  const result = await rescoreCompanies(sector, Number.isFinite(offset) ? offset : 0);
  return NextResponse.json({ ok: true, ...result });
}
