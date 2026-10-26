import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { normalizeEntityKind } from "@/lib/directory/service";
import {
  ensureCrm,
  getRelationship,
  updateRelationship,
  type RelationshipPatch,
} from "@/lib/directory/crm";

/**
 * CRM Phase 1 — relationship profile for one Directory record.
 * Nested under the existing record route exactly as DESIGN.md
 * specifies: record/[kind]/[id]/relationship. GET returns
 * { relationship } (null when the record has no profile yet);
 * PUT upserts via updateRelationship and returns the profile.
 */

async function gate(
  user: ReturnType<typeof getSessionUser>,
  kindRaw: string
) {
  if (!user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      kind: null,
    };
  }
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return {
      error: NextResponse.json({ error: "internal_only" }, { status: 403 }),
      kind: null,
    };
  }
  const kind = normalizeEntityKind(kindRaw);
  if (!kind) {
    return {
      error: NextResponse.json(
        { error: "kind must be 'person' or 'organization'" },
        { status: 400 }
      ),
      kind: null,
    };
  }
  await ensurePlatform();
  await ensureDirectory();
  await ensureCrm();
  return { error: null, kind };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { kind: string; id: string } }
) {
  const user = getSessionUser();
  const { error, kind } = await gate(user, params.kind);
  if (error || !kind) return error as NextResponse;
  const relationship = await getRelationship(kind, params.id);
  return NextResponse.json(
    { relationship },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { kind: string; id: string } }
) {
  const user = getSessionUser();
  const { error, kind } = await gate(user, params.kind);
  if (error || !kind) return error as NextResponse;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Accept the patch at the top level or under `relationship`.
  const src =
    body.relationship && typeof body.relationship === "object"
      ? (body.relationship as Record<string, unknown>)
      : body;
  const patch: RelationshipPatch = {};
  if (typeof src.tier === "string") patch.tier = src.tier;
  if (typeof src.stage === "string") patch.stage = src.stage;
  if (src.cadenceDays !== undefined || src.cadence_days !== undefined) {
    const v = src.cadenceDays ?? src.cadence_days;
    patch.cadenceDays =
      v === null ? null : typeof v === "number" && isFinite(v) ? v : undefined;
  }
  if (typeof src.owner === "string") patch.owner = src.owner;
  if (typeof src.source === "string") patch.source = src.source;
  if (src.introducedByPersonId !== undefined || src.introduced_by_person_id !== undefined) {
    const v = src.introducedByPersonId ?? src.introduced_by_person_id;
    patch.introducedByPersonId = typeof v === "string" && v ? v : null;
  }
  if (typeof src.commPrefs === "string") patch.commPrefs = src.commPrefs;
  else if (typeof src.comm_prefs === "string") patch.commPrefs = src.comm_prefs;
  // A&D attributes (Focus & Theme, Oct 26, 2026).
  if (typeof src.adCertifications === "string") patch.adCertifications = src.adCertifications;
  else if (typeof src.ad_certifications === "string") patch.adCertifications = src.ad_certifications;
  if (typeof src.adItar === "string") patch.adItar = src.adItar;
  else if (typeof src.ad_itar === "string") patch.adItar = src.ad_itar;
  if (typeof src.adClearance === "string") patch.adClearance = src.adClearance;
  else if (typeof src.ad_clearance === "string") patch.adClearance = src.ad_clearance;
  if (typeof src.adPrimeCustomers === "string") patch.adPrimeCustomers = src.adPrimeCustomers;
  else if (typeof src.ad_prime_customers === "string") patch.adPrimeCustomers = src.ad_prime_customers;
  if (Array.isArray(src.importantDates)) {
    patch.importantDates = src.importantDates as RelationshipPatch["importantDates"];
  } else if (Array.isArray(src.important_dates)) {
    patch.importantDates = src.important_dates as RelationshipPatch["importantDates"];
  }
  if (Array.isArray(src.tags)) {
    patch.tags = src.tags.map((t) => String(t)).filter(Boolean);
  }
  try {
    const relationship = await updateRelationship(
      kind,
      params.id,
      patch,
      user!.name || user!.email
    );
    return NextResponse.json({ relationship });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
