import { NextRequest, NextResponse } from "next/server";
import { getDealFlow, saveDealFlow, newId, logActivity } from "@/lib/db";
import { shouldAutoDismiss } from "@/lib/az-location";
import { getSessionUser } from "@/lib/auth";
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
  const item: DealFlowItem = {
    id: newId(),
    kind: KINDS.includes(body.kind) ? body.kind : "business_for_sale",
    title: String(body.title).trim(),
    source: String(body.source ?? "").trim(),
    sourceDetail: String(body.sourceDetail ?? ""),
    spottedAt: String(body.spottedAt ?? now.slice(0, 10)),
    why: String(body.why ?? ""),
    industry: String(body.industry ?? "").trim(),
    location: String(body.location ?? "").trim(),
    status: shouldAutoDismiss(KINDS.includes(body.kind) ? body.kind : "business_for_sale", String(body.location ?? "").trim()) ? "dismissed" : "new",
    relatedDealId: null,
    relatedExecId: null,
    createdAt: now,
    updatedAt: now,
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
  return NextResponse.json(item, { status: 201 });
}
