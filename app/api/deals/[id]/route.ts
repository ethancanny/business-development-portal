import { NextRequest, NextResponse } from "next/server";
import { getDeals, saveDeals, getExecutives, logActivity } from "@/lib/db";
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

type Params = { params: { id: string } };

function unauthorized() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const denied = unauthorized();
  if (denied) return denied;
  const deals = await getDeals();
  const deal = deals.find((d) => d.id === params.id);
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(deal);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const denied = unauthorized();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const deals = await getDeals();
  const idx = deals.findIndex((d) => d.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const prev = deals[idx];
  const newStage = DEAL_STAGES.includes(body.stage) ? body.stage : prev.stage;
  const newOwner =
    body.owner !== undefined ? String(body.owner).trim() : prev.owner;
  const newOperatorIds =
    body.operatorIds !== undefined
      ? parseIdList(body.operatorIds)
      : prev.operatorIds ?? [];
  const newCity =
    body.city !== undefined ? String(body.city).trim() : prev.city;
  let lat = prev.lat ?? null;
  let lng = prev.lng ?? null;
  if (newCity !== (prev.city ?? "")) {
    const geo = newCity ? await geocodeCity(newCity) : null;
    lat = geo?.lat ?? null;
    lng = geo?.lng ?? null;
  }
  const updated: Deal = {
    ...prev,
    companyName:
      body.companyName !== undefined
        ? String(body.companyName).trim()
        : prev.companyName,
    industry:
      body.industry !== undefined ? String(body.industry).trim() : prev.industry,
    stage: newStage,
    dealValue:
      body.dealValue !== undefined ? Number(body.dealValue) || 0 : prev.dealValue,
    contactName:
      body.contactName !== undefined
        ? String(body.contactName).trim()
        : prev.contactName,
    contactEmail:
      body.contactEmail !== undefined
        ? String(body.contactEmail).trim()
        : prev.contactEmail,
    notes: body.notes !== undefined ? String(body.notes) : prev.notes,
    owner: newOwner,
    city: newCity,
    lat,
    lng,
    links: body.links !== undefined ? parseLinks(body.links) : prev.links ?? [],
    operatorIds: newOperatorIds,
    revenue:
      body.revenue !== undefined
        ? body.revenue === null || body.revenue === "" ? null : Number(body.revenue) || null
        : prev.revenue ?? null,
    ebitda:
      body.ebitda !== undefined
        ? body.ebitda === null || body.ebitda === "" ? null : Number(body.ebitda) || null
        : prev.ebitda ?? null,
    askingPrice:
      body.askingPrice !== undefined
        ? body.askingPrice === null || body.askingPrice === "" ? null : Number(body.askingPrice) || null
        : prev.askingPrice ?? null,
    broker:
      body.broker !== undefined ? String(body.broker).trim() : prev.broker ?? "",
    source:
      body.source !== undefined ? String(body.source).trim() : prev.source ?? "",
    updatedAt: new Date().toISOString(),
  };

  deals[idx] = updated;
  await saveDeals(deals);

  const user = getSessionUser();
  const actor = user?.name ?? "Someone";
  if (newStage !== prev.stage) {
    await logActivity({
      type: "deal.stage",
      actor,
      message: `${actor} moved ${updated.companyName} from ${prev.stage} to ${newStage}`,
      dealId: updated.id,
      execId: null,
      dealName: updated.companyName,
      execName: null,
    });
  } else if (
    JSON.stringify([...newOperatorIds].sort()) !==
    JSON.stringify([...(prev.operatorIds ?? [])].sort())
  ) {
    const execs = await getExecutives();
    const names = newOperatorIds.map(
      (id) => execs.find((e) => e.id === id)?.name ?? "someone"
    );
    await logActivity({
      type: "deal.operators",
      actor,
      message:
        names.length > 0
          ? `${actor} paired ${names.join(", ")} with ${updated.companyName}`
          : `${actor} removed all operator pairings from ${updated.companyName}`,
      dealId: updated.id,
      execId: null,
      dealName: updated.companyName,
      execName: null,
    });
  } else if (newOwner !== (prev.owner ?? "")) {
    await logActivity({
      type: "deal.claim",
      actor,
      message: newOwner
        ? `${actor} gave ${updated.companyName} to ${newOwner}`
        : `${actor} released the claim on ${updated.companyName}`,
      dealId: updated.id,
      execId: null,
      dealName: updated.companyName,
      execName: null,
    });
  } else {
    await logActivity({
      type: "deal.updated",
      actor,
      message: `${actor} updated ${updated.companyName}`,
      dealId: updated.id,
      execId: null,
      dealName: updated.companyName,
      execName: null,
    });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const denied = unauthorized();
  if (denied) return denied;
  const deals = await getDeals();
  const idx = deals.findIndex((d) => d.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [removed] = deals.splice(idx, 1);
  await saveDeals(deals);
  const user = getSessionUser();
  await logActivity({
    type: "deal.deleted",
    actor: user?.name ?? "Someone",
    message: `${user?.name ?? "Someone"} removed ${removed.companyName} from the pipeline`,
    dealId: null,
    execId: null,
    dealName: removed.companyName,
    execName: null,
  });
  return NextResponse.json({ ok: true });
}
