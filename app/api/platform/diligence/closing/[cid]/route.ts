import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import {
  updateClosingItem,
  deleteClosingItem,
} from "@/lib/diligence/service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { cid: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const item = await updateClosingItem(params.cid, {
      category: typeof body.category === "string" ? body.category : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
      dueDate:
        typeof body.dueDate === "string" || body.dueDate === null
          ? (body.dueDate as string | null)
          : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    return ok({ item });
  } catch (err) {
    return serviceError(err, "closing-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { cid: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteClosingItem(params.cid);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "closing-delete");
  }
}
