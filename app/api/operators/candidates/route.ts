import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  CANDIDATE_STATUSES,
  createOrMergeCandidate,
  isCandidateStatus,
  listCandidates,
  validateSource,
  type CandidateInput,
} from "@/lib/candidates-db";

/**
 * Operator candidates (Operator Discovery & Sourcing spec, Build 1).
 * POST creates a candidate — or merges a sighting into the existing
 * record when name+company+title already exists. sourceUrl is REQUIRED
 * (Ethan, Oct 16, 2026): every candidate carries the URL it was found
 * at, and the "LinkedIn" label is accepted only for linkedin.com URLs.
 */

function actorOf(): string | null {
  const user = getSessionUser();
  return user ? user.name || user.email : null;
}

export async function GET(req: NextRequest) {
  if (!actorOf()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const boolParam = (v: string | null): boolean | undefined =>
    v === "true" ? true : v === "false" ? false : undefined;
  const candidates = await listCandidates({
    status: sp.get("status") ?? undefined,
    focusSector: boolParam(sp.get("focusSector")),
    locationVerified: boolParam(sp.get("locationVerified")),
    q: sp.get("q") ?? undefined,
    sort: sp.get("sort") ?? undefined,
  });
  return NextResponse.json(candidates);
}

export async function POST(req: NextRequest) {
  const actor = actorOf();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as CandidateInput;

  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }
  const sourceType = String(body.sourceType ?? "").trim();
  const sourceUrl = String(body.sourceUrl ?? "").trim();
  const sourceError = validateSource(sourceType, sourceUrl);
  if (sourceError) {
    return NextResponse.json({ error: sourceError }, { status: 400 });
  }
  if (body.status !== undefined && !isCandidateStatus(String(body.status))) {
    return NextResponse.json(
      {
        error: `status must be one of: ${CANDIDATE_STATUSES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  try {
    const { candidate, merged } = await createOrMergeCandidate(
      { ...body, name, sourceType, sourceUrl },
      actor
    );
    return NextResponse.json(
      { ...candidate, merged },
      { status: merged ? 200 : 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 500 }
    );
  }
}
