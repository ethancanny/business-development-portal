import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getCandidate, getMatchState, listCandidates } from "@/lib/candidates-db";
import { OPERATOR_MATCH_STRONG } from "@/lib/candidates-scoring";

/**
 * Reverse match view (Build 2): which candidates match a given fit
 * target or pipeline deal — the "shown on the target" half of the
 * spec's matching. With no target parameter, returns the
 * operator-needed snapshot: fit targets + active deals with no
 * candidate whose match clears OPERATOR_MATCH_STRONG.
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
  const candidateId = sp.get("candidateId");
  const companyId = sp.get("companyId");
  const dealId = sp.get("dealId");

  if (candidateId) {
    const c = await getCandidate(candidateId);
    if (!c) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }
    return NextResponse.json({
      candidate: { id: c.id, name: c.name, score: c.score, scoredAt: c.scoredAt },
      matches: c.matchedTargets,
      conflicts: c.conflicts,
    });
  }

  if (companyId || dealId) {
    const type = companyId ? "company" : "deal";
    const id = (companyId ?? dealId) as string;
    const all = await listCandidates();
    const matched = all
      .map((c) => {
        const m = c.matchedTargets.find((x) => x.type === type && x.id === id);
        return m
          ? {
              candidateId: c.id,
              name: c.name,
              currentTitle: c.currentTitle,
              company: c.company,
              candidateScore: c.score,
              matchScore: m.matchScore,
              relation: m.relation,
              basis: m.basis,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.matchScore - a.matchScore);
    return NextResponse.json({
      target: { type, id },
      strongThreshold: OPERATOR_MATCH_STRONG,
      candidates: matched,
    });
  }

  const state = await getMatchState();
  if (!state) {
    return NextResponse.json({
      computedAt: null,
      strongThreshold: OPERATOR_MATCH_STRONG,
      operatorNeededTotal: 0,
      operatorNeeded: [],
      note: "No rescore has run yet — POST /api/operators/candidates/rescore first.",
    });
  }
  return NextResponse.json(state);
}
