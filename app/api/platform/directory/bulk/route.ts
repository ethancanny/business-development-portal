import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccessContext } from "@/lib/platform/permissions";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { normalizeEntityKind } from "@/lib/directory/service";
import {
  ensureCrm,
  getRelationship,
  updateRelationship,
  addListMembers,
  createLinkedTask,
} from "@/lib/directory/crm";

/**
 * CRM Phase 1 — bulk actions over Directory records.
 * Body: { kind, ids, action, value } with actions
 *   assign_owner (value: owner string)
 *   add_tag      (value: tag string — unioned with existing tags)
 *   set_tier     (value: tier string)
 *   add_to_list  (value: listId string)
 *   create_task  (value: { title, dueDate } — or a title string)
 * Composed from the crm.ts service exports per DESIGN.md; create_task
 * uses createLinkedTask (see MANIFEST — the one assumed export, since
 * DESIGN names no task-create service and the legacy Task type cannot
 * link person/organization records).
 */

const ACTIONS = ["assign_owner", "add_tag", "set_tier", "add_to_list", "create_task"] as const;

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ctx = await getAccessContext(user);
  if (ctx.companyIds !== null) {
    return NextResponse.json({ error: "internal_only" }, { status: 403 });
  }
  await ensurePlatform();
  await ensureDirectory();
  await ensureCrm();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = normalizeEntityKind(body.kind);
  const ids = Array.isArray(body.ids)
    ? body.ids.map((v) => String(v).trim()).filter(Boolean)
    : [];
  const action = typeof body.action === "string" ? body.action : "";
  if (!kind || !ids.length || !(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json(
      {
        error:
          "kind, ids (non-empty) and a valid action (assign_owner | add_tag | set_tier | add_to_list | create_task) are required",
      },
      { status: 400 }
    );
  }
  if (ids.length > 200) {
    return NextResponse.json(
      { error: "bulk actions are capped at 200 records per request" },
      { status: 400 }
    );
  }
  const actor = user.name || user.email;
  const value = body.value;
  try {
    if (action === "add_to_list") {
      const listId = typeof value === "string" ? value.trim() : "";
      if (!listId) {
        return NextResponse.json(
          { error: "value (listId) is required for add_to_list" },
          { status: 400 }
        );
      }
      const result = await addListMembers(listId, kind, ids);
      return NextResponse.json({ ok: true, action, kind, affected: result.added, ...result });
    }
    if (action === "create_task") {
      const title =
        typeof value === "string"
          ? value.trim()
          : value && typeof value === "object"
            ? String((value as Record<string, unknown>).title ?? "").trim()
            : "";
      const dueDate =
        value && typeof value === "object"
          ? String((value as Record<string, unknown>).dueDate ?? "").trim() || undefined
          : undefined;
      if (!title) {
        return NextResponse.json(
          { error: "value.title is required for create_task" },
          { status: 400 }
        );
      }
      let affected = 0;
      for (const id of ids) {
        await createLinkedTask(
          { title, dueDate, relatedKind: kind, relatedId: id, owner: actor },
          actor
        );
        affected++;
      }
      return NextResponse.json({ ok: true, action, kind, affected });
    }
    // assign_owner | add_tag | set_tier — relationship-profile writes.
    const scalar = typeof value === "string" ? value.trim() : "";
    if (!scalar) {
      return NextResponse.json(
        { error: `value is required for ${action}` },
        { status: 400 }
      );
    }
    let affected = 0;
    for (const id of ids) {
      if (action === "assign_owner") {
        await updateRelationship(kind, id, { owner: scalar }, actor);
      } else if (action === "set_tier") {
        await updateRelationship(kind, id, { tier: scalar }, actor);
      } else {
        // add_tag: union with the tags the profile currently carries
        // (updateRelationship replaces tags when the patch has them).
        const current = await getRelationship(kind, id);
        const existing = current?.tags ?? [];
        const tags = existing.includes(scalar) ? existing : [...existing, scalar];
        await updateRelationship(kind, id, { tags }, actor);
      }
      affected++;
    }
    return NextResponse.json({ ok: true, action, kind, affected });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
