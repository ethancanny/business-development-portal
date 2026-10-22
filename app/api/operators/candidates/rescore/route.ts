import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { rescoreAllCandidates } from "@/lib/candidates-scoring";
import { evalCandidateHighScores } from "@/lib/push-evals";

/**
 * Operator candidate rescore (Build 2): recomputes every candidate's
 * fit score (0–100 with factor breakdown), top-3 target/deal matches,
 * and conflict flags, and refreshes the operator-needed snapshot.
 * Location-unverified candidates are never scored (spec).
 */

export const maxDuration = 300;

function actorOf(): string | null {
  const user = getSessionUser();
  return user ? user.name || user.email : null;
}

export async function POST() {
  const actor = actorOf();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await rescoreAllCandidates(actor);
    await evalCandidateHighScores().catch(() => undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Rescore failed" },
      { status: 500 }
    );
  }
}
