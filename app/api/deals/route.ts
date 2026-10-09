import { NextRequest, NextResponse } from "next/server";
import { getDeals, saveDeals, newId, logActivity } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { geocodeCity } from "@/lib/geo";
import { DEAL_STAGES, type Deal, type DealLink } from "@/lib/types";

function parseIdList(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  return body.map((v) => String(v)).filter((v) => v !== "");
}

function parseLinks(body: unknown): DealLink[] {
  if (!Array.isArray(body)) return [];
  return body
    .filter(
      (l): l is { label?: unknown; url?: unknown } =>
        typeof l === "object" && l !== null
    )
    .map((l) => ({
      label: String(l.label ?? "").trim(),
      url: String(l.url ?? "").trim(),
    }))
    .filter((l) => l.url !== "");
}

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getDeals());
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.companyName || String(body.companyName).trim() === "") {
    return NextResponse.json(
      { error: "companyName is required" },
      { status: 400 }
    );
  }

  const deals = await getDeals();
  const now = new Date().toISOString();
  const city = String(body.city ?? "").trim();
  const geo = city ? await geocodeCity(city) : null;
  const deal: Deal = {
    id: newId(),
    companyName: String(body.companyName).trim(),
    industry: String(body.industry ?? "").trim(),
    stage: DEAL_STAGES.includes(body.stage) ? body.stage : "Sourcing",
    dealValue: Number(body.dealValue) || 0,
    contactName: String(body.contactName ?? "").trim(),
    contactEmail: String(body.contactEmail ?? "").trim(),
    notes: String(body.notes ?? ""),
    owner: String(body.owner ?? "").trim() || user.name,
    city,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
    links: parseLinks(body.links),
    operatorIds: parseIdList(body.operatorIds),
    revenue: body.revenue === null || body.revenue === undefined || body.revenue === "" ? null : Number(body.revenue) || null,
    ebitda: body.ebitda === null || body.ebitda === undefined || body.ebitda === "" ? null : Number(body.ebitda) || null,
    askingPrice: body.askingPrice === null || body.askingPrice === undefined || body.askingPrice === "" ? null : Number(body.askingPrice) || null,
    broker: String(body.broker ?? "").trim(),
    source: String(body.source ?? "").trim(),
    createdAt: now,
    updatedAt: now,
  };

  deals.push(deal);
  await saveDeals(deals);
  await logActivity({
    type: "deal.created",
    actor: user.name,
    message: `${user.name} added ${deal.companyName} to the pipeline`,
    dealId: deal.id,
    execId: null,
    dealName: deal.companyName,
    execName: null,
  });
  return NextResponse.json(deal, { status: 201 });
}
