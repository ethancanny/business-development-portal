import { NextRequest, NextResponse } from "next/server";
import { upsertListings, type ListingInput } from "@/lib/market-db";

/**
 * Bulk listing import — used by the Google Sheet sync job.
 * Body: { listings: ListingInput[] }
 * Auth: Bearer CRON_SECRET (same as the ingest endpoint).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const listings = Array.isArray(body.listings) ? body.listings : [];
  const rows: ListingInput[] = listings
    .filter((l: unknown) => !!l && typeof l === "object" && ((l as Record<string, unknown>).url || (l as Record<string, unknown>).title))
    .map((l: Record<string, unknown>) => ({
      title: String(l.title ?? "Untitled"),
      price: l.price ?? null,
      revenue: l.revenue ?? null,
      cashFlow: l.cashFlow ?? null,
      industry: String(l.industry ?? ""),
      location: String(l.location ?? ""),
      broker: String(l.broker ?? ""),
      url: String(l.url ?? ""),
      source: String(l.source ?? "Google Sheet"),
      description: String(l.description ?? ""),
    }));
  try {
    const added = await upsertListings(rows);
    return NextResponse.json({ ok: true, received: rows.length, added });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
