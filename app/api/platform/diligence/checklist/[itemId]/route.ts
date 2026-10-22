import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import {
  updateChecklistItem,
  deleteChecklistItem,
} from "@/lib/diligence/service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { itemId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const item = await updateChecklistItem(params.itemId, {
      workstream: str(body.workstream),
      title: str(body.title),
      owner: str(body.owner),
      status: str(body.status),
      dueDate:
        typeof body.dueDate === "string" || body.dueDate === null
          ? (body.dueDate as string | null)
          : undefined,
      notes: str(body.notes),
      dataroomChecklistItemId:
        typeof body.dataroomChecklistItemId === "string" ||
        body.dataroomChecklistItemId === null
          ? (body.dataroomChecklistItemId as string | null)
          : undefined,
      dataroomDocumentId:
        typeof body.dataroomDocumentId === "string" ||
        body.dataroomDocumentId === null
          ? (body.dataroomDocumentId as string | null)
          : undefined,
    });
    return ok({ item });
  } catch (err) {
    return serviceError(err, "checklist-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { itemId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteChecklistItem(params.itemId);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "checklist-delete");
  }
}
