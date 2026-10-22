import { NextRequest, NextResponse } from "next/server";
import { getDealFlow, saveDealFlow, newId, logActivity } from "@/lib/db";
import { shouldAutoDismiss } from "@/lib/az-location";
import { isHospitalityListing, screenHospitalityListing } from "@/lib/hospitality-screen";
import { getSessionUser } from "@/lib/auth";
import { evalNewListingItem } from "@/lib/push-evals";
import { drainPushJobs } from "@/lib/push-schedule";
import type { DealFlowItem, DealFlowKind } from "@/lib/types";

const KINDS: DealFlowKind[] = [
  "business_for_sale",
  "operator_available",
  "market_note",
];

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const items = await getDealFlow();
  // One-pass cleanup: dismiss any still-open non-Arizona listings.
  let changed = false;
  for (const it of items) {
    if (it.status === "new" && shouldAutoDismiss(it.kind, it.location || "")) {
      it.status = "dismissed";
      it.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) await saveDealFlow(items);
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (!body.title || String(body.title).trim() === "") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const kind: DealFlowKind = KINDS.includes(body.kind) ? body.kind : "business_for_sale";
  const title = String(body.title).trim();
  const industry = String(body.industry ?? "").trim();
  const location = String(body.location ?? "").trim();
  // Classification (portal layer): the AZ rule first, then — for
  // hospitality listings only — the §5 screen (multi-unit ≥3 or a
  // hotel/lodging property, viability on stated figures). A screened-out
  // item is still created, as "dismissed", exactly like a non-AZ
  // listing: registered, never surfaced as new. Optional structured
  // figures (price / cashFlow / locations) may ride the POST body.
  let status: DealFlowItem["status"] = shouldAutoDismiss(kind, location) ? "dismissed" : "new";
  if (status === "new" && kind === "business_for_sale" && isHospitalityListing(industry, title)) {
    const num = (v: unknown): number | null => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const verdict = await screenHospitalityListing({
      title,
      industry,
      location,
      why: String(body.why ?? ""),
      price: num(body.price),
      cashFlow: num(body.cashFlow),
      locations: num(body.locations),
    });
    if (!verdict.pass) status = "dismissed";
  }
  const item: DealFlowItem = {
    id: newId(),
    kind,
    title,
    source: String(body.source ?? "").trim(),
    sourceDetail: String(body.sourceDetail ?? ""),
    spottedAt: String(body.spottedAt ?? now.slice(0, 10)),
    why: String(body.why ?? ""),
    industry,
    location,
    status,
    relatedDealId: null,
    relatedExecId: null,
    createdAt: now,
    updatedAt: now,
    readAt: null,
  };
  const items = await getDealFlow();
  items.unshift(item);
  await saveDealFlow(items);

  const actor = user.name || user.email;
  await logActivity({
    type: "flow.created",
    actor,
    message: `${actor} added "${item.title}" to Deal Flow`,
    dealId: null,
    execId: null,
    dealName: null,
    execName: null,
  });
  if (item.kind === "business_for_sale") {
    await evalNewListingItem(item, new Date()).catch(() => undefined);
  }
  await drainPushJobs().catch(() => undefined);
  return NextResponse.json(item, { status: 201 });
}
