import { NextRequest, NextResponse } from "next/server";
import { getTasks, saveTasks, logActivity } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

type Params = { params: { id: string } };

function unauthorized() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function PUT(req: NextRequest, { params }: Params) {
  const denied = unauthorized();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const tasks = await getTasks();
  const idx = tasks.findIndex((t) => t.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const prev = tasks[idx];
  const updated = {
    ...prev,
    title: body.title !== undefined ? String(body.title).trim() : prev.title,
    dueDate:
      body.dueDate !== undefined ? String(body.dueDate).trim() : prev.dueDate,
    done: body.done !== undefined ? Boolean(body.done) : prev.done,
    owner: body.owner !== undefined ? String(body.owner).trim() : prev.owner,
    updatedAt: new Date().toISOString(),
  };
  if (!updated.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  tasks[idx] = updated;
  await saveTasks(tasks);

  const user = getSessionUser();
  const actor = user?.name ?? "Someone";
  if (updated.done !== prev.done) {
    await logActivity({
      type: updated.done ? "task.completed" : "task.reopened",
      actor,
      message: updated.done
        ? `${actor} completed: ${updated.title}`
        : `${actor} reopened: ${updated.title}`,
      dealId: updated.relatedKind === "deal" ? updated.relatedId : null,
      execId: updated.relatedKind === "executive" ? updated.relatedId : null,
      dealName:
        updated.relatedKind === "deal" ? updated.relatedName || null : null,
      execName:
        updated.relatedKind === "executive"
          ? updated.relatedName || null
          : null,
    });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const denied = unauthorized();
  if (denied) return denied;
  const tasks = await getTasks();
  const idx = tasks.findIndex((t) => t.id === params.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [removed] = tasks.splice(idx, 1);
  await saveTasks(tasks);
  const user = getSessionUser();
  await logActivity({
    type: "task.deleted",
    actor: user?.name ?? "Someone",
    message: `${user?.name ?? "Someone"} deleted a follow-up: ${removed.title}`,
    dealId: null,
    execId: null,
    dealName: null,
    execName: null,
  });
  return NextResponse.json({ ok: true });
}
