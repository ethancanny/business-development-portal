import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { createClosingItem } from "@/lib/diligence/service";

/**
 * POST — add a closing checklist item. category 'post_closing' items
 * with a due date generate Calendar events via the calgen registry.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const item = await createClosingItem(params.id, {
      category: typeof body.category === "string" ? body.category : undefined,
      title: typeof body.title === "string" ? body.title : "",
      dueDate:
        typeof body.dueDate === "string" || body.dueDate === null
          ? (body.dueDate as string | null)
          : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    return ok({ item }, 201);
  } catch (err) {
    return serviceError(err, "closing-create");
  }
}
