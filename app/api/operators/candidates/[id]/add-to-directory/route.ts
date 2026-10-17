import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getCandidate,
  updateCandidate,
} from "@/lib/candidates-db";
import { candidateSector } from "@/lib/candidates-scoring";
import {
  getExecutives,
  logActivity,
  newId,
  saveExecutives,
} from "@/lib/db";
import type { Executive } from "@/lib/types";

/**
 * "Add to Directory" (Operator Discovery spec Build 4, Oct 16, 2026):
 * create an Executive Sourcing pipeline record from a candidate and
 * store the link on the candidate (directory_exec_id), so the person
 * is never double-counted and a second click can never create a
 * second record. Idempotent: when the link already points at a live
 * executive, that executive is returned unchanged (created: false).
 * If the linked executive was deleted, a fresh one is created and the
 * link is re-pointed.
 */

type Params = { params: { id: string } };

export async function POST(_req: NextRequest, { params }: Params) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = user.name || user.email;

  const candidate = await getCandidate(params.id);
  if (!candidate) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const execs = await getExecutives();
  if (candidate.directoryExecId) {
    const existing = execs.find((e) => e.id === candidate.directoryExecId);
    if (existing) {
      return NextResponse.json({
        executive: existing,
        candidate,
        created: false,
      });
    }
    // Link points at a deleted record — fall through and recreate.
  }

  const now = new Date().toISOString();
  const sector = candidateSector(candidate);
  const provenance = [
    `Added to Directory from operator candidate on ${now.slice(0, 10)}.`,
    `Found via ${candidate.sourceType || "—"}: ${candidate.sourceUrl}`,
    candidate.score !== null
      ? `Candidate score ${candidate.score}/100${candidate.scoredAt ? ` (scored ${candidate.scoredAt.slice(0, 10)})` : ""}.`
      : "Candidate not yet scored.",
    candidate.referrer ? `Referrer: ${candidate.referrer}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const exec: Executive = {
    id: newId(),
    name: candidate.name,
    currentTitle: candidate.currentTitle,
    targetRole: candidate.targetRole,
    stage: "Sourcing",
    background: candidate.fitNotes ?? "",
    notes: provenance,
    owner: actor,
    industries: Array.from(
      new Set(
        [candidate.industry, sector !== "Other" ? sector : ""]
          .map((s) => (s ?? "").trim())
          .filter(Boolean)
      )
    ),
    createdAt: now,
    updatedAt: now,
  };

  execs.push(exec);
  await saveExecutives(execs);
  await logActivity({
    type: "exec.created",
    actor,
    message: `${actor} added ${exec.name} to executive sourcing (from operator candidate)`,
    dealId: null,
    execId: exec.id,
    dealName: null,
    execName: exec.name,
  });

  const linked = await updateCandidate(
    candidate.id,
    { directoryExecId: exec.id },
    actor
  );

  return NextResponse.json(
    { executive: exec, candidate: linked ?? candidate, created: true },
    { status: 201 }
  );
}
