import { NextRequest, NextResponse } from "next/server";
import { getTasks, saveTasks, logActivity } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { cancelPushJobs, scheduleTaskPushJobs } from "@/lib/push-schedule";
import type { Task, TaskType } from "@/lib/types";

type Params = { params: { id: string } };

const TASK_TYPES: TaskType[] = ["Call", "Email", "Meeting", "Send docs", "Other"];

function parseDueTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? `${m[1]}:${m[2]}` : null;
}

function unauthorized() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** Reconcile the task's Outlook event after any mutation (best-effort). */
async function syncCalendar(task: Task, tasks: Task[]): Promise<void> {
  try {
    const { syncTaskEvent } = await import("@/lib/microsoft");
    const eventId = await syncTaskEvent(task);
    if (eventId !== task.calendarEventId) {
      task.calendarEventId = eventId;
      task.updatedAt = new Date().toISOString();
      await saveTasks(tasks);
    }
  } catch {
    /* the watchdog pull remains as the safety net */
  }
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
  const now = new Date().toISOString();
  const done =
    body.done !== undefined ? Boolean(body.done) : prev.done;

  // Re-linking: accept a full related triple, or clear it with relatedKind null.
  let relatedKind = prev.relatedKind;
  let relatedId = prev.relatedId;
  let relatedName = prev.relatedName;
  if (body.relatedKind !== undefined) {
    if (body.relatedKind === "deal" || body.relatedKind === "executive") {
      relatedKind = body.relatedKind;
      relatedId = String(body.relatedId ?? "") || null;
      relatedName = String(body.relatedName ?? "").trim();
    } else {
      relatedKind = null;
      relatedId = null;
      relatedName = "";
    }
  }

  const updated: Task = {
    ...prev,
    title: body.title !== undefined ? String(body.title).trim() : prev.title,
    dueDate:
      body.dueDate !== undefined ? String(body.dueDate).trim() : prev.dueDate,
    dueTime:
      body.dueTime !== undefined ? parseDueTime(body.dueTime) : prev.dueTime,
    type:
      body.type !== undefined
        ? TASK_TYPES.includes(body.type)
          ? (body.type as TaskType)
          : prev.type
        : prev.type,
    priority:
      body.priority !== undefined
        ? body.priority === "high"
          ? "high"
          : "normal"
        : prev.priority,
    notes: body.notes !== undefined ? String(body.notes) : prev.notes,
    done,
    completedAt: done ? (prev.done ? prev.completedAt : now) : null,
    owner: body.owner !== undefined ? String(body.owner).trim() : prev.owner,
    relatedKind,
    relatedId,
    relatedName,
    updatedAt: now,
  };
  if (!updated.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  tasks[idx] = updated;
  await saveTasks(tasks);
  // Phase 2: keep the calendar generated-events layer fresh.
  try {
    const { requestGeneratedEventsRefresh } = await import("@/lib/calgen/service");
    await requestGeneratedEventsRefresh();
  } catch { /* generated layer refresh is best-effort */ }

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

  // Calendar follows the follow-up: reschedule/snooze moves the event,
  // completing removes it, reopening recreates it.
  await syncCalendar(updated, tasks);
  await scheduleTaskPushJobs(params.id).catch(() => undefined);
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
  // Remove the synced calendar event first (best-effort) so the two
  // never drift apart.
  if (removed.calendarEventId) {
    try {
      const { deleteGraphEvent } = await import("@/lib/microsoft");
      await deleteGraphEvent(removed.calendarEventId);
    } catch {
      /* the watchdog pull remains as the safety net */
    }
  }
  await saveTasks(tasks);
  // Phase 2: keep the calendar generated-events layer fresh.
  try {
    const { requestGeneratedEventsRefresh } = await import("@/lib/calgen/service");
    await requestGeneratedEventsRefresh();
  } catch { /* generated layer refresh is best-effort */ }
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
  await cancelPushJobs("task", params.id).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
