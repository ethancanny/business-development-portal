import { NextRequest, NextResponse } from "next/server";
import { runMarketIngest, type IngestSource } from "@/lib/market-ingest";

/**
 * Market intel ingest endpoint. Triggered by Vercel Cron (see vercel.json).
 * Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` for cron
 * invocations when CRON_SECRET is set — we verify it here.
 */
export const maxDuration = 60;

const SOURCES: IngestSource[] = ["indicators", "filings", "news", "bankruptcy_news", "warn", "entities", "multiples", "defense", "census", "all"];

function authorized(req: NextRequest): boolean {
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
  const result = await runMarketIngest(source);
  return NextResponse.json({ ok: true, result });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
