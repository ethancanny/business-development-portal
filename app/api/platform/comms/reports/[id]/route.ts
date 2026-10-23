import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError, NO_STORE } from "@/lib/comms/http";
import { deleteReport, getReport, updateReport } from "@/lib/comms/service";

/** GET one report — the service detail carries the report row plus
 *  versions meta, deliveries and audit; passed through verbatim. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const detail = await getReport(params.id);
    if (!detail) {
      return NextResponse.json(
        { error: "report_not_found" },
        { status: 404, headers: NO_STORE }
      );
    }
    return ok(detail);
  } catch (err) {
    return serviceError(err, "report-detail");
  }
}

/** PATCH title / narrative edits — the service writes a NEW version
 *  (draft/in_review only, else 'report_locked'). Body:
 *  { title?, narrative?: { [blockKey]: statements[] }, note? } */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const patch: Record<string, unknown> = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (body.narrative && typeof body.narrative === "object") {
      patch.narrative = body.narrative;
    }
    if (typeof body.note === "string") patch.note = body.note;
    const report = await updateReport(
      params.id,
      patch as Parameters<typeof updateReport>[1],
      gate.user.name || gate.user.email
    );
    return ok({ report });
  } catch (err) {
    return serviceError(err, "report-update");
  }
}

/** DELETE (soft) a report. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    await deleteReport(params.id, gate.user.name || gate.user.email);
    return ok({ deleted: true });
  } catch (err) {
    return serviceError(err, "report-delete");
  }
}
