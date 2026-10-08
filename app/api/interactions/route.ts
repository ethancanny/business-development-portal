import { NextRequest, NextResponse } from "next/server";
import {
  getInteractions,
  saveInteractions,
  getDeals,
  getExecutives,
  newId,
  logActivity,
} from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import type { Interaction, InteractionKind } from "@/lib/types";

const KINDS: InteractionKind[] = ["call", "email", "meeting", "note"];

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const dealId = searchParams.get("dealId");
  const execId = searchParams.get("execId");
  let items = await getInteractions();
  if (dealId) items = items.filter((i) => i.dealId === dealId);
  if (execId) items = items.filter((i) => i.execId === execId);
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (!body.summary || String(body.summary).trim() === "") {
    return NextResponse.json({ error: "summary is required" }, { status: 400 });
  }
  const kind: InteractionKind = KINDS.includes(body.kind) ? body.kind : "note";
  const now = new Date().toISOString();
  const item: Interaction = {
    id: newId(),
    dealId: body.dealId ? String(body.dealId) : null,
    execId: body.execId ? String(body.execId) : null,
    kind,
    occurredAt: String(body.occurredAt ?? now.slice(0, 10)),
    summary: String(body.summary).trim(),
    createdAt: now,
  };
  const items = await getInteractions();
  items.push(item);
  await saveInteractions(items);

  const actor = user.name || user.email;
  let dealName: string | null = null;
  let execName: string | null = null;
  if (item.dealId) {
    dealName =
      (await getDeals()).find((d) => d.id === item.dealId)?.companyName ?? null;
  }
  if (item.execId) {
    execName =
      (await getExecutives()).find((e) => e.id === item.execId)?.name ?? null;
  }
  await logActivity({
    type: "deal.interaction",
    actor,
    message: `${actor} logged a ${kind} with ${dealName ?? execName ?? "a record"}`,
    dealId: item.dealId,
    execId: item.execId,
    dealName,
    execName,
  });
  return NextResponse.json(item, { status: 201 });
}
