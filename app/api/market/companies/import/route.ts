import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { importCompanies, type CompanyInput } from "@/lib/market-db";

/**
 * Bulk company-profile import — used by the weekly registry spine builders
 * (SAM.gov, AZ ROC, NPPES, EPA FRS digests). Body:
 * { source, reset?: boolean, companies: CompanyInput[] }
 * Send reset=true on the first chunk of a fresh snapshot for a source;
 * subsequent chunks upsert. Auth: session cookie OR Bearer CRON_SECRET.
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
  const source = String(body.source ?? "").trim();
  if (!source) {
    return NextResponse.json({ error: "source required" }, { status: 400 });
  }
  const raw = Array.isArray(body.companies) ? body.companies : [];
  const rows: CompanyInput[] = raw
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
      source,
      sourceUrl: String(c.sourceUrl ?? ""),
      details: typeof c.details === "string" ? c.details.slice(0, 4000) : "",
    }))
    .filter((r: CompanyInput) => r.dedupKey && r.name);
  try {
    const res = await importCompanies(source, rows, body.reset === true);
    return NextResponse.json({ ok: true, source, received: res.received, total: res.total });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
