import { NextRequest, NextResponse } from "next/server";
import { getTasks, saveTasks, newId, logActivity } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { scheduleTaskPushJobs } from "@/lib/push-schedule";
import { recountTaskLink } from "@/lib/directory/crm";
import type { Task, TaskType } from "@/lib/types";

const TASK_TYPES: TaskType[] = ["Call", "Email", "Meeting", "Send docs", "Other"];

function parseDueTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? `${m[1]}:${m[2]}` : null;
}

function parseTaskType(v: unknown): TaskType {
  return TASK_TYPES.includes(v as TaskType) ? (v as TaskType) : "Call";
}

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tasks = await getTasks();
  tasks.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const da = a.dueDate || "9999-12-31";
    const db = b.dueDate || "9999-12-31";
    if (da !== db) return da.localeCompare(db);
    // All-day (no time) first, then timed in order.
    return (a.dueTime ?? "").localeCompare(b.dueTime ?? "");
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

  // CRM Phase 1: 'person' / 'organization' links are also accepted so
  // CRM-created follow-ups can point at Directory records (cast past
  // the legacy TaskRelatedKind union, which only names deal/executive;
  // the stored value is what the CRM summary recount reads).
  const relatedKind =
    body.relatedKind === "deal" ||
    body.relatedKind === "executive" ||
    body.relatedKind === "person" ||
    body.relatedKind === "organization"
      ? (body.relatedKind as Task["relatedKind"])
      : null;

  const now = new Date().toISOString();
  const task: Task = {
    id: newId(),
    title: String(body.title).trim(),
    dueDate: String(body.dueDate ?? "").trim(),
    dueTime: parseDueTime(body.dueTime),
    type: parseTaskType(body.type),
    priority: body.priority === "high" ? "high" : "normal",
    notes: String(body.notes ?? "").trim(),
    done: false,
    completedAt: null,
    owner: String(body.owner ?? "").trim(),
    relatedKind,
    relatedId: relatedKind ? String(body.relatedId ?? "") || null : null,
    relatedName: String(body.relatedName ?? "").trim(),
    calendarEventId: null,
    createdAt: now,
    updatedAt: now,
  };

  const tasks = await getTasks();
  tasks.push(task);
  await saveTasks(tasks);
  // CRM Phase 1 hook: a new person/organization/executive-linked task
  // changes that record's open_task_count summary.
  await recountTaskLink(task.relatedKind, task.relatedId).catch(() => undefined);
  // Phase 2: keep the calendar generated-events layer fresh.
  try {
    const { requestGeneratedEventsRefresh } = await import("@/lib/calgen/service");
    await requestGeneratedEventsRefresh();
  } catch { /* generated layer refresh is best-effort */ }
  await scheduleTaskPushJobs(task.id).catch(() => undefined);
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
  // Calendar sync via the existing Graph integration (Ethan, Oct 9, 2026;
  // extended Oct 16, 2026): every dated follow-up gets a matching Outlook
  // event — timed at its time, all-day when no time is set — and the task
  // records the event id so later edits/completion/deletion reconcile.
  // Best-effort — never fail task creation because Microsoft is unreachable.
  if (task.dueDate) {
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
  return NextResponse.json(task, { status: 201 });
}
