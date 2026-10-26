import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  CANDIDATE_STATUSES,
  createOrMergeCandidate,
  getCandidateSummary,
  isCandidateStatus,
  listCandidates,
  validateSource,
  type CandidateInput,
  type OperatorCandidate,
} from "@/lib/candidates-db";
import { datasetVersionHeader } from "@/lib/platform/versions";
import { candidateSector } from "@/lib/candidates-scoring";
import { evalCandidatesByIds } from "@/lib/push-evals";

/** Build 4: the Directory chip needs the display sector (focus sector
 * name, or "Other") — computed server-side from the Build 2 helper so
 * the client never re-derives it. */
function withSector(c: OperatorCandidate) {
  return { ...c, sector: candidateSector(c) };
}

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
  // Performance Fix Pass: both modes carry the candidates dataset
  // version + a private cache header; ?summary=1 returns server-side
  // counts only (status + date_found), never full candidate rows.
  if (sp.get("summary") === "1") {
    const summary = await getCandidateSummary();
    return NextResponse.json(summary, {
      headers: {
        "Cache-Control": "private, max-age=300",
        ...(await datasetVersionHeader("candidates")),
      },
    });
  }
  const boolParam = (v: string | null): boolean | undefined =>
    v === "true" ? true : v === "false" ? false : undefined;
  const candidates = await listCandidates({
    status: sp.get("status") ?? undefined,
    focusSector: boolParam(sp.get("focusSector")),
    locationVerified: boolParam(sp.get("locationVerified")),
    q: sp.get("q") ?? undefined,
    sort: sp.get("sort") ?? undefined,
  });
  return NextResponse.json(candidates.map(withSector), {
    headers: {
      "Cache-Control": "private, max-age=300",
      ...(await datasetVersionHeader("candidates")),
    },
  });
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
    await evalCandidatesByIds([candidate.id]).catch(() => undefined);
    return NextResponse.json(
      { ...withSector(candidate), merged },
      { status: merged ? 200 : 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 500 }
    );
  }
}
