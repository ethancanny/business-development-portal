import { NextRequest, NextResponse } from "next/server";
import { getDeals, saveDeals, newId, logActivity } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { geocodeCity } from "@/lib/geo";
import { ALL_DEAL_STAGES, type Deal, type DealDrivers, type DealLink, type DealMetrics, type DealStructureInput, type InvestmentTypeKey } from "@/lib/types";
import { parseInvestmentType, parseSourcedFromType } from "@/lib/bd/service";

const DRIVER_KEYS = ["concentration", "recurring", "ownerDependence", "growth", "margins", "management", "financials"] as const;

function parseDrivers(body: unknown): DealDrivers {
  if (!body || typeof body !== "object") return {};
  const out: DealDrivers = {};
  for (const k of DRIVER_KEYS) {
    const v = (body as Record<string, unknown>)[k];
    if (v === "neg" || v === "neu" || v === "pos") out[k] = v;
  }
  return out;
}

function parseStructure(body: unknown): DealStructureInput {
  if (!body || typeof body !== "object") return {};
  const out: DealStructureInput = {};
  const keys = ["cashPct", "sellerPct", "earnoutPct", "rolloverPct"] as const;
  for (const k of keys) {
    const v = (body as Record<string, unknown>)[k];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (isFinite(n)) out[k] = Math.max(0, Math.min(100, n));
  }
  const amtKeys = ["cashAmt", "sellerAmt", "earnoutAmt", "rolloverAmt"] as const;
  for (const k of amtKeys) {
    const v = (body as Record<string, unknown>)[k];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (isFinite(n)) out[k] = Math.max(0, Math.min(1e12, n));
  }
  const termKeys = ["sellerRatePct", "sellerTermYrs"] as const;
  for (const k of termKeys) {
    const v = (body as Record<string, unknown>)[k];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (isFinite(n)) out[k] = Math.max(0, Math.min(40, n));
  }
  const probKeys = ["earnoutPeriodYrs", "earnoutProbPct", "rolloverVestYrs", "rolloverProbPct"] as const;
  for (const k of probKeys) {
    const v = (body as Record<string, unknown>)[k];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (isFinite(n)) out[k] = Math.max(0, Math.min(100, n));
  }
  const metric = (body as Record<string, unknown>)["earnoutMetric"];
  if (typeof metric === "string" && ["EBITDA", "Revenue", "Gross profit", "Other"].includes(metric)) {
    out.earnoutMetric = metric;
  }
  return out;
}

function parseMetrics(body: unknown): DealMetrics {
  if (!body || typeof body !== "object") return {};
  const out: DealMetrics = {};
  const pctKeys = ["topCustomerPct", "top3Pct", "recurringPct"] as const;
  for (const k of pctKeys) {
    const v = (body as Record<string, unknown>)[k];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (isFinite(n)) out[k] = Math.max(0, Math.min(100, n));
  }
  const h = (body as Record<string, unknown>)["ownerHoursPerWeek"];
  if (h !== null && h !== undefined && h !== "") {
    const n = Number(h);
    if (isFinite(n)) out.ownerHoursPerWeek = Math.max(0, Math.min(80, n));
  }
  return out;
}

function parseIdList(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  // Dedupe: a repeated operator id would render the same pairing chip
  // twice on the deal (Ethan, Oct 14, 2026).
  return Array.from(new Set(body.map((v) => String(v)).filter((v) => v !== "")));
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
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Phase 9: the deal pipeline is internal-only — company-scoped
  // management sessions never see it.
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "internal_only" }, { status: 403 });
  }
  const deals = await getDeals();
  // Deal Identity enrichment: company link + logo version + accent
  // for mark rendering in table / Kanban / card surfaces.
  try {
    const { identitySummariesForDeals } = await import("@/lib/identity/service");
    const summaries = await identitySummariesForDeals(deals.map((d) => d.id));
    for (const d of deals) {
      const s = summaries.get(d.id);
      if (s) {
        d.companyId = s.companyId;
        d.logoVersion = s.logoVersion;
        d.accentColor = s.accentColor;
      }
    }
  } catch {
    /* identity enrichment is decorative — deals still serve */
  }
  return NextResponse.json(deals);
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
  // Investment Types (Step 1): the type comes from the request
  // (default Platform LBO); the stage must belong to the type's
  // configured list (bd.type_config via the bd service).
  const investmentType: InvestmentTypeKey =
    parseInvestmentType(body.investmentType) ?? "platform_lbo";
  const parentDealId =
    typeof body.parentDealId === "string" && body.parentDealId
      ? body.parentDealId
      : null;
  if (investmentType === "add_on" && !parentDealId) {
    return NextResponse.json(
      {
        error: "parent_required",
        message: "An add-on must link to its parent platform deal.",
      },
      { status: 400 }
    );
  }
  if (
    parentDealId &&
    !deals.some((d) => d.id === parentDealId)
  ) {
    return NextResponse.json(
      { error: "parent_not_found", message: "Parent platform deal not found." },
      { status: 400 }
    );
  }
  const { stagesForType } = await import("@/lib/bd/service");
  const typeStages = await stagesForType(investmentType);
  const stage =
    typeof body.stage === "string" && typeStages.includes(body.stage)
      ? body.stage
      : typeof body.stage === "string" &&
          (ALL_DEAL_STAGES as readonly string[]).includes(body.stage)
        ? body.stage
        : (typeStages[0] ?? "Sourced");
  const deal: Deal = {
    id: newId(),
    companyName: String(body.companyName).trim(),
    industry: String(body.industry ?? "").trim(),
    stage,
    investmentType,
    parentDealId,
    sourcedFromType: parseSourcedFromType(body.sourcedFromType),
    sourcedFromId:
      typeof body.sourcedFromId === "string" && body.sourcedFromId
        ? body.sourcedFromId
        : null,
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
    growthPct: body.growthPct === null || body.growthPct === undefined || body.growthPct === "" ? null : Math.max(-60, Math.min(150, Number(body.growthPct) || 0)) || null,
    askingPrice: body.askingPrice === null || body.askingPrice === undefined || body.askingPrice === "" ? null : Number(body.askingPrice) || null,
    broker: String(body.broker ?? "").trim(),
    passReason: String(body.passReason ?? "").trim(),
    source: String(body.source ?? "").trim(),
    drivers: parseDrivers(body.drivers),
    structure: parseStructure(body.structure),
    metrics: parseMetrics(body.metrics),
    synthesis: null,
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
  // BD → Due Diligence handoff (Oct 24, 2026): a deal created directly
  // in (or past) a diligence stage gets its workspace immediately.
  // Best-effort and idempotent — the create stands regardless.
  try {
    const { ensureWorkspaceForDeal } = await import(
      "@/lib/diligence/service"
    );
    await ensureWorkspaceForDeal(deal.id, user.name);
  } catch {
    /* handoff wiring is best-effort — the create stands */
  }
  return NextResponse.json(deal, { status: 201 });
}
