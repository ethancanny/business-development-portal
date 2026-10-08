import { NextRequest, NextResponse } from "next/server";
import { getTasks, saveTasks, newId, logActivity } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import type { Task } from "@/lib/types";

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tasks = await getTasks();
  tasks.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const da = a.dueDate || "9999-12-31";
    const db = b.dueDate || "9999-12-31";
    return da.localeCompare(db);
  });
  return NextResponse.json(tasks);
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.title || String(body.title).trim() === "") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const relatedKind =
    body.relatedKind === "deal" || body.relatedKind === "executive"
      ? body.relatedKind
      : null;

  const now = new Date().toISOString();
  const task: Task = {
    id: newId(),
    title: String(body.title).trim(),
    dueDate: String(body.dueDate ?? "").trim(),
    done: false,
    owner: String(body.owner ?? "").trim(),
    relatedKind,
    relatedId: relatedKind ? String(body.relatedId ?? "") || null : null,
    relatedName: String(body.relatedName ?? "").trim(),
    createdAt: now,
    updatedAt: now,
  };

  const tasks = await getTasks();
  tasks.push(task);
  await saveTasks(tasks);
  await logActivity({
    type: "task.created",
    actor: user.name,
    message: task.relatedName
      ? `${user.name} added a follow-up for ${task.relatedName}: ${task.title}`
      : `${user.name} added a follow-up: ${task.title}`,
    dealId: task.relatedKind === "deal" ? task.relatedId : null,
    execId: task.relatedKind === "executive" ? task.relatedId : null,
    dealName: task.relatedKind === "deal" ? task.relatedName || null : null,
    execName:
      task.relatedKind === "executive" ? task.relatedName || null : null,
  });
  return NextResponse.json(task, { status: 201 });
}
