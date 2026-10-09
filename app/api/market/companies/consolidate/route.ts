import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { consolidateCompanies, type ConsolidateRow } from "@/lib/market-db";

/**
 * Company consolidation — replaces duplicate member rows (same company across
 * locations, registrations, sectors, and sources) with one row per company.
 * Body: { companies: [{ ...company fields, absorb: ["source|dedupKey", ...] }] }
 * Auth: session cookie OR Bearer CRON_SECRET (same as the import endpoint).
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
  const raw = Array.isArray(body.companies) ? body.companies : [];
  const rows: ConsolidateRow[] = raw
    .filter((c: unknown) => !!c && typeof c === "object")
    .map((c: Record<string, unknown>) => ({
      dedupKey: String(c.dedupKey ?? "").trim(),
      name: String(c.name ?? "").trim(),
      sector: String(c.sector ?? ""),
      subsector: String(c.subsector ?? ""),
      naics: String(c.naics ?? ""),
      city: String(c.city ?? ""),
      state: String(c.state ?? "AZ"),
      address: String(c.address ?? ""),
      zip: String(c.zip ?? ""),
      contactName: String(c.contactName ?? ""),
      contactTitle: String(c.contactTitle ?? ""),
      phone: String(c.phone ?? ""),
      website: String(c.website ?? ""),
      formedDate: String(c.formedDate ?? ""),
      employees: typeof c.employees === "number" ? Math.round(c.employees) : null,
      signalValue: typeof c.signalValue === "number" ? c.signalValue : null,
      signalLabel: String(c.signalLabel ?? ""),
      source: String(c.source ?? "").trim(),
      sourceUrl: String(c.sourceUrl ?? ""),
      details: typeof c.details === "string" ? c.details.slice(0, 4000) : "",
      absorb: Array.isArray(c.absorb)
        ? c.absorb.filter((k): k is string => typeof k === "string").slice(0, 500)
        : [],
    }))
    .filter((r: ConsolidateRow) => r.dedupKey && r.name && r.source);
  try {
    const res = await consolidateCompanies(rows);
    return NextResponse.json({ ok: true, groups: res.groups, absorbed: res.absorbed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
