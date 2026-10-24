import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import {
  createChecklistItem,
  listChecklistItems,
} from "@/lib/diligence/service";

/** GET — the workspace's checklist items (per-tab load, redesign). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const items = await listChecklistItems(params.id);
    return ok({ items });
  } catch (err) {
    return serviceError(err, "checklist-list");
  }
}

/** POST — add a checklist item to the workspace. */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const item = await createChecklistItem(
      params.id,
      {
        workstream:
          typeof body.workstream === "string" ? body.workstream : undefined,
        title: typeof body.title === "string" ? body.title : "",
        owner: typeof body.owner === "string" ? body.owner : undefined,
        status: typeof body.status === "string" ? body.status : undefined,
        dueDate:
          typeof body.dueDate === "string" || body.dueDate === null
            ? (body.dueDate as string | null)
            : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
        priority: typeof body.priority === "string" ? body.priority : undefined,
        description:
          typeof body.description === "string" ? body.description : undefined,
        dataroomChecklistItemId:
          typeof body.dataroomChecklistItemId === "string"
            ? body.dataroomChecklistItemId
            : null,
        dataroomDocumentId:
          typeof body.dataroomDocumentId === "string"
            ? body.dataroomDocumentId
            : null,
      },
      gate.user.name
    );
    return ok({ item }, 201);
  } catch (err) {
    return serviceError(err, "checklist-create");
  }
}
