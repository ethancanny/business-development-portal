import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listCandidates } from "@/lib/candidates-db";
import { candidateSector } from "@/lib/candidates-scoring";
import {
  CANDIDATE_COLUMNS,
  exportResponse,
  formatFromParam,
} from "@/lib/platform/tabular";

/** Operator candidates export (Phase 10). Columns shared with the
 * candidates import (lib/platform/tabular CANDIDATE_COLUMNS). */

const CAP = 5000;

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const format = formatFromParam(req.nextUrl.searchParams.get("format"));
  const candidates = await listCandidates();
  const truncated = candidates.length > CAP;
  const rows: Record<string, unknown>[] = candidates.slice(0, CAP).map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company,
    title: c.currentTitle,
    sector: candidateSector(c),
    location: c.city,
    score: c.score,
    status: c.status,
    sourceUrl: c.sourceUrl,
    sourceType: c.sourceType,
    industry: c.industry,
    createdAt: c.createdAt,
  }));
  return exportResponse(
    rows,
    CANDIDATE_COLUMNS,
    "candidates-export",
    format,
    truncated
  );
}
