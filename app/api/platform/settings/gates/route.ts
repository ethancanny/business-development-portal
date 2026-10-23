import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getUserRole } from "@/lib/platform/permissions";
import {
  listGateRules,
  updateGateRules,
  CONDITION_CATALOG,
} from "@/lib/workflow/gates";

/**
 * Settings → Stage Gates data (Phase 10).
 * GET  → { rules, conditions } — every workflow.gate_rules row plus the
 *        condition catalog (key / defaultLabel / description).
 * PUT  { rules: [{ id, enabled }] } — admin-only (requireAdmin pattern
 *        from settings/users): flips enabled flags, returns the rules.
 */

async function requireAdmin() {
  const user = getSessionUser();
  if (!user) return { error: 401 as const };
  await ensurePlatform();
  const role = await getUserRole(user.email);
  if (role !== "admin") return { error: 403 as const };
  return { user };
}

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const rules = await listGateRules();
  return NextResponse.json({ rules, conditions: CONDITION_CATALOG });
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin();
  if ("error" in gate) {
    return NextResponse.json(
      { error: gate.error === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.error }
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    rules?: unknown;
  };
  if (!Array.isArray(body.rules)) {
    return NextResponse.json(
      { error: "rules array is required" },
      { status: 400 }
    );
  }
  const updates: Array<{ id: string; enabled: boolean }> = [];
  for (const item of body.rules) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : "";
    if (!id) continue;
    updates.push({ id, enabled: Boolean(rec.enabled) });
  }
  const rules = await updateGateRules(updates);
  return NextResponse.json({ ok: true, rules, conditions: CONDITION_CATALOG });
}
