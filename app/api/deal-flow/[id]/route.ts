import { NextRequest, NextResponse } from "next/server";
import { getDealFlow, saveDealFlow, logActivity } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import type { DealFlowStatus } from "@/lib/types";

interface Params {
  params: { id: string };
}

const STATUSES: DealFlowStatus[] = ["new", "reviewed", "added", "dismissed"];

export async function PUT(req: NextRequest, { params }: Params) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const items = await getDealFlow();
  const idx = items.findIndex((f) => f.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const prev = items[idx];
  const updated = {
    ...prev,
    status: STATUSES.includes(body.status) ? body.status : prev.status,
    relatedDealId:
      body.relatedDealId !== undefined
        ? body.relatedDealId
          ? String(body.relatedDealId)
          : null
        : prev.relatedDealId,
    relatedExecId:
      body.relatedExecId !== undefined
        ? body.relatedExecId
          ? String(body.relatedExecId)
          : null
        : prev.relatedExecId,
    updatedAt: new Date().toISOString(),
  };
  items[idx] = updated;
  await saveDealFlow(items);

  if (body.status === "added" && prev.status !== "added") {
    const actor = user.name || user.email;
    await logActivity({
      type: "flow.converted",
      actor,
      message: `${actor} moved "${updated.title}" from Deal Flow into the pipeline`,
      dealId: updated.relatedDealId,
      execId: updated.relatedExecId,
      dealName: null,
      execName: null,
    });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const items = await getDealFlow();
  const idx = items.findIndex((f) => f.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  items.splice(idx, 1);
  await saveDealFlow(items);
  return NextResponse.json({ ok: true });
}
