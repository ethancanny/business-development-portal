import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  CandidateCollisionError,
  deleteCandidate,
  getCandidate,
  getCandidateAudit,
  updateCandidate,
  type CandidateInput,
} from "@/lib/candidates-db";

/**
 * Single operator candidate (Build 1). GET includes the record's audit
 * history; PATCH edits fields/status (identity changes re-check the
 * name+company+title key against other records); DELETE removes the
 * record — the audit entry is written first and survives the delete.
 */

type Params = { params: { id: string } };

function actorOf(): string | null {
  const user = getSessionUser();
  return user ? user.name || user.email : null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  if (!actorOf()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const candidate = await getCandidate(params.id);
  if (!candidate) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const audit = await getCandidateAudit(params.id);
  return NextResponse.json({ ...candidate, audit });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const actor = actorOf();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as CandidateInput;
  try {
    const updated = await updateCandidate(params.id, body, actor);
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof CandidateCollisionError) {
      return NextResponse.json(
        { error: err.message, conflictingId: err.conflicting.id },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "Update failed";
    const status = /^(status must be|sourceUrl|sourceType)/.test(message)
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const actor = actorOf();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const removed = await deleteCandidate(params.id, actor);
  if (!removed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, deleted: removed.id });
}
