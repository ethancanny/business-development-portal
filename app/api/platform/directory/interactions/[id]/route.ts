import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import {
  ensureCrm,
  updateInteraction,
  deleteInteraction,
  type UpdateInteractionPatch,
} from "@/lib/directory/crm";

/**
 * CRM Phase 1 — single Interaction. PATCH maps the service's
 * Error('prediction_locked') to 400 (predicted reply % is locked
 * once saved); DELETE is the service's soft delete.
 */

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

const strOrNull = (v: unknown): string | null | undefined =>
  v === null ? null : str(v);

const numOrNull = (v: unknown): number | null | undefined => {
  if (v === null) return null;
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && isFinite(Number(v))) return Number(v);
  return undefined;
};

async function gate(user: ReturnType<typeof getSessionUser>) {
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "internal_only" }, { status: 403 });
  }
  await ensurePlatform();
  await ensureDirectory();
  await ensureCrm();
  return null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  const blocked = await gate(user);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: UpdateInteractionPatch = {};
  if (body.type !== undefined) patch.type = str(body.type);
  if (body.direction !== undefined) patch.direction = str(body.direction);
  if (body.occurredAt !== undefined || body.occurred_at !== undefined)
    patch.occurredAt = str(body.occurredAt) ?? str(body.occurred_at);
  if (body.summary !== undefined) patch.summary = str(body.summary);
  if (body.outcome !== undefined) patch.outcome = str(body.outcome);
  if (body.nextStep !== undefined || body.next_step !== undefined)
    patch.nextStep = str(body.nextStep) ?? str(body.next_step);
  if (body.nextStepDue !== undefined || body.next_step_due !== undefined)
    patch.nextStepDue = strOrNull(body.nextStepDue) ?? strOrNull(body.next_step_due);
  if (body.predictedReplyPct !== undefined || body.predicted_reply_pct !== undefined)
    patch.predictedReplyPct =
      numOrNull(body.predictedReplyPct) ?? numOrNull(body.predicted_reply_pct);
  if (body.visibility !== undefined) patch.visibility = str(body.visibility);
  if (body.owner !== undefined) patch.owner = str(body.owner);
  if (body.organizationId !== undefined || body.organization_id !== undefined)
    patch.organizationId = strOrNull(body.organizationId) ?? strOrNull(body.organization_id);
  if (body.companyId !== undefined || body.company_id !== undefined)
    patch.companyId = strOrNull(body.companyId) ?? strOrNull(body.company_id);
  if (body.dealId !== undefined || body.deal_id !== undefined)
    patch.dealId = strOrNull(body.dealId) ?? strOrNull(body.deal_id);
  if (body.raiseDealId !== undefined || body.raise_deal_id !== undefined)
    patch.raiseDealId = strOrNull(body.raiseDealId) ?? strOrNull(body.raise_deal_id);
  try {
    const interaction = await updateInteraction(
      params.id,
      patch,
      user!.name || user!.email
    );
    if (!interaction) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ interaction });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "prediction_locked") {
      return NextResponse.json({ error: "prediction_locked" }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  const blocked = await gate(user);
  if (blocked) return blocked;
  const deleted = await deleteInteraction(params.id, user!.name || user!.email);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
