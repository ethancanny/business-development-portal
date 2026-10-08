import { NextRequest, NextResponse } from "next/server";
import { getExecutives, saveExecutives, logActivity } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { EXEC_STAGES, type Executive } from "@/lib/types";

type Params = { params: { id: string } };

function unauthorized() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const denied = unauthorized();
  if (denied) return denied;
  const execs = await getExecutives();
  const exec = execs.find((e) => e.id === params.id);
  if (!exec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(exec);
}

function parseIndustries(body: unknown): string[] {
  const list = Array.isArray(body)
    ? body
    : typeof body === "string"
      ? body.split(",")
      : [];
  return list.map((v) => String(v).trim()).filter((v) => v !== "");
}

export async function PUT(req: NextRequest, { params }: Params) {
  const denied = unauthorized();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const execs = await getExecutives();
  const idx = execs.findIndex((e) => e.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const prev = execs[idx];
  const newStage = EXEC_STAGES.includes(body.stage) ? body.stage : prev.stage;
  const newOwner =
    body.owner !== undefined ? String(body.owner).trim() : prev.owner;
  const updated: Executive = {
    ...prev,
    name: body.name !== undefined ? String(body.name).trim() : prev.name,
    currentTitle:
      body.currentTitle !== undefined
        ? String(body.currentTitle).trim()
        : prev.currentTitle,
    targetRole:
      body.targetRole !== undefined
        ? String(body.targetRole).trim()
        : prev.targetRole,
    stage: newStage,
    background:
      body.background !== undefined ? String(body.background) : prev.background,
    notes: body.notes !== undefined ? String(body.notes) : prev.notes,
    owner: newOwner,
    industries:
      body.industries !== undefined
        ? parseIndustries(body.industries)
        : prev.industries ?? [],
    updatedAt: new Date().toISOString(),
  };

  execs[idx] = updated;
  await saveExecutives(execs);

  const user = getSessionUser();
  const actor = user?.name ?? "Someone";
  if (newStage !== prev.stage) {
    await logActivity({
      type: "exec.stage",
      actor,
      message: `${actor} moved ${updated.name} from ${prev.stage} to ${newStage}`,
      dealId: null,
      execId: updated.id,
      dealName: null,
      execName: updated.name,
    });
  } else if (newOwner !== (prev.owner ?? "")) {
    await logActivity({
      type: "exec.claim",
      actor,
      message: newOwner
        ? `${actor} gave ${updated.name} to ${newOwner}`
        : `${actor} released the claim on ${updated.name}`,
      dealId: null,
      execId: updated.id,
      dealName: null,
      execName: updated.name,
    });
  } else {
    await logActivity({
      type: "exec.updated",
      actor,
      message: `${actor} updated ${updated.name}`,
      dealId: null,
      execId: updated.id,
      dealName: null,
      execName: updated.name,
    });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const denied = unauthorized();
  if (denied) return denied;
  const execs = await getExecutives();
  const idx = execs.findIndex((e) => e.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [removed] = execs.splice(idx, 1);
  await saveExecutives(execs);
  const user = getSessionUser();
  await logActivity({
    type: "exec.deleted",
    actor: user?.name ?? "Someone",
    message: `${user?.name ?? "Someone"} removed ${removed.name} from executive sourcing`,
    dealId: null,
    execId: null,
    dealName: null,
    execName: removed.name,
  });
  return NextResponse.json({ ok: true });
}
