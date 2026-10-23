import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getUnifiedTasks } from "@/lib/platform/collab";
import {
  exportResponse,
  formatFromParam,
  type TabularColumn,
} from "@/lib/platform/tabular";

/**
 * Unified tasks export (Phase 10, export-only): the same read model
 * behind GET /api/platform/tasks (lib/platform/collab getUnifiedTasks).
 * UnifiedTask carries no createdAt — the column set adapts to the real
 * shape (due/status/priority + the resolved link) rather than
 * inventing one.
 */

const COLUMNS: TabularColumn[] = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "assignee", label: "Assignee" },
  { key: "due", label: "Due" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "type", label: "Type" },
  { key: "linkedKind", label: "Linked Kind" },
  { key: "linkedName", label: "Linked Name" },
];

const CAP = 5000;

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const format = formatFromParam(req.nextUrl.searchParams.get("format"));
  const items = await getUnifiedTasks();
  const truncated = items.length > CAP;
  const rows: Record<string, unknown>[] = items.slice(0, CAP).map((t) => ({
    id: t.id,
    title: t.title,
    assignee: t.assignee,
    due: t.dueAt,
    status: t.status,
    priority: t.priority,
    type: t.type,
    linkedKind: t.linked?.kind ?? "",
    linkedName: t.linked?.label ?? "",
  }));
  return exportResponse(rows, COLUMNS, "tasks-export", format, truncated);
}
