import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { upsertListings, type ListingInput } from "@/lib/market-db";

/**
 * Bulk listing import — used by the Google Sheet sync job and the morning
 * email sweep. Body: { listings: ListingInput[] }
 * Auth: session cookie OR Bearer CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  const authed =
    !!getSessionUser() ||
    (() => {
      const secret = process.env.CRON_SECRET;
      return !secret || req.headers.get("authorization") === `Bearer ${secret}`;
    })();
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const listings = Array.isArray(body.listings) ? body.listings : [];
  const rows: ListingInput[] = listings
    .filter((l: unknown) => !!l && typeof l === "object")
    .map((l: Record<string, unknown>) => {
      const title = String(l.title ?? "Untitled").trim() || "Untitled";
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
      return {
        title,
        price: l.price ?? null,
        revenue: l.revenue ?? null,
        cashFlow: l.cashFlow ?? null,
        industry: String(l.industry ?? ""),
        location: String(l.location ?? ""),
        broker: String(l.broker ?? ""),
        // Email teasers often have no URL — synthesize a stable dedup key from the title.
        url: String(l.url ?? "") || `email:${slug}`,
        source: String(l.source ?? "Google Sheet"),
        description: String(l.description ?? ""),
      };
    })
    .filter((r: ListingInput) => r.title !== "Untitled" || r.url.startsWith("http"));
  try {
    const added = await upsertListings(rows);
    return NextResponse.json({ ok: true, received: rows.length, added });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
