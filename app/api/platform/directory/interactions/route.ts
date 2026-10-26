import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { ensureCrm, createInteraction, listInteractions } from "@/lib/directory/crm";

/**
 * CRM Phase 1 — Interactions collection.
 * Auth preamble copied from app/api/platform/directory/route.ts
 * (session + internal-only), plus ensureCrm() per DESIGN.md.
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

function personIdsFrom(body: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim() && !out.includes(v.trim())) out.push(v.trim());
    else if (v && typeof v === "object") {
      const rec = v as Record<string, unknown>;
      const id = str(rec.personId) ?? str(rec.id) ?? str(rec.entityId);
      if (id && !out.includes(id)) out.push(id);
    }
  };
  if (Array.isArray(body.personIds)) body.personIds.forEach(push);
  if (Array.isArray(body.participantIds)) body.participantIds.forEach(push);
  if (Array.isArray(body.participants)) body.participants.forEach(push);
  push(body.personId);
  push(body.primaryPersonId);
  return out;
}

export async function GET(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "internal_only" }, { status: 403 });
  }
  await ensurePlatform();
  await ensureDirectory();
  await ensureCrm();
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? 25);
  const offsetRaw = Number(sp.get("offset") ?? 0);
  const { items, total } = await listInteractions(
    {
      personId: sp.get("personId") ?? undefined,
      organizationId: sp.get("organizationId") ?? undefined,
      dealId: sp.get("dealId") ?? undefined,
      limit: Math.min(50, Math.max(1, isFinite(limitRaw) ? limitRaw : 25)),
      offset: Math.max(0, isFinite(offsetRaw) ? offsetRaw : 0),
    },
    user.name || user.email
  );
  return NextResponse.json(
    { items, total },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "internal_only" }, { status: 403 });
  }
  await ensurePlatform();
  await ensureDirectory();
  await ensureCrm();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const type = str(body.type);
  if (!type) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const personIds = personIdsFrom(body);
  const primaryPersonId =
    str(body.primaryPersonId) ?? str(body.personId) ?? personIds[0];
  try {
    const result = await createInteraction(
      {
        type,
        direction: str(body.direction),
        occurredAt: str(body.occurredAt) ?? str(body.occurred_at),
        summary: str(body.summary),
        outcome: str(body.outcome),
        nextStep: str(body.nextStep) ?? str(body.next_step),
        nextStepDue: strOrNull(body.nextStepDue) ?? strOrNull(body.next_step_due),
        predictedReplyPct:
          numOrNull(body.predictedReplyPct) ?? numOrNull(body.predicted_reply_pct),
        visibility: str(body.visibility),
        owner: str(body.owner),
        personIds,
        primaryPersonId: primaryPersonId ?? null,
        organizationId: strOrNull(body.organizationId) ?? strOrNull(body.organization_id),
        companyId: strOrNull(body.companyId) ?? strOrNull(body.company_id),
        dealId: strOrNull(body.dealId) ?? strOrNull(body.deal_id),
        raiseDealId: strOrNull(body.raiseDealId) ?? strOrNull(body.raise_deal_id),
        force: body.force === true,
      },
      user.name || user.email
    );
    if ("duplicateOf" in result && result.duplicateOf) {
      return NextResponse.json({ duplicateOf: result.duplicateOf }, { status: 409 });
    }
    const ok = result as { interaction: unknown; taskId: string | null };
    return NextResponse.json(
      { interaction: ok.interaction, taskId: ok.taskId ?? null },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
