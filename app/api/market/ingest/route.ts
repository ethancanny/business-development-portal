import { NextRequest, NextResponse } from "next/server";
import { runMarketIngest, type IngestSource } from "@/lib/market-ingest";
import { getSessionUser } from "@/lib/auth";

/**
 * Market intel ingest endpoint. Triggered by Vercel Cron (see vercel.json).
 * Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` for cron
 * invocations when CRON_SECRET is set — we verify it here. An authenticated
 * portal session is also accepted (used by the frequent events sweep).
 */
export const maxDuration = 60;

const SOURCES: IngestSource[] = ["indicators", "filings", "news", "econ_events", "bankruptcy_news", "warn", "entities", "multiples", "defense", "census", "county_permits", "permits_ci", "sector_counts", "commodity_spot", "susb_sizes", "intel_news", "hospitality", "adhs", "tailwind", "signals", "all"];

function authorized(req: NextRequest): boolean {
  if (getSessionUser()) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev without CRON_SECRET
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const source = (req.nextUrl.searchParams.get("source") ?? "all") as IngestSource;
  if (!SOURCES.includes(source)) {
    return NextResponse.json({ error: "Unknown source" }, { status: 400 });
  }
  // Tailwind acceptance-test hooks (only meaningful with
  // source=tailwind): ?testAge=city_tax:24,aot_lodging:12 pretends those
  // components are N months older (staleness-drop proof);
  // ?failTest=city_tax forces that dataset's fetch to throw (failure
  // isolation proof). A plain run afterwards restores normal state.
  const tailwindOpts: { force?: boolean; failDataset?: string; ageOverrides?: Record<string, number> } = {};
  const testAge = req.nextUrl.searchParams.get("testAge");
  if (testAge) {
    const overrides: Record<string, number> = {};
    for (const part of testAge.split(",")) {
      const [k, v] = part.split(":");
      const months = Number(v);
      if (k && Number.isFinite(months) && months > 0) overrides[k] = months;
    }
    if (Object.keys(overrides).length) tailwindOpts.ageOverrides = overrides;
  }
  const failTest = req.nextUrl.searchParams.get("failTest");
  if (failTest) tailwindOpts.failDataset = failTest;
  const result = await runMarketIngest(source, { tailwind: tailwindOpts });
  return NextResponse.json({ ok: true, result });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
