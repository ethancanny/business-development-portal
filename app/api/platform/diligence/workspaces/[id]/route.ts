import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import {
  getWorkspaceBundle,
  updateWorkspace,
  deleteWorkspace,
} from "@/lib/diligence/service";

/** GET the full workspace bundle (checklist, requests, findings, …). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const bundle = await getWorkspaceBundle(params.id);
    return ok(bundle);
  } catch (err) {
    return serviceError(err, "workspace-bundle");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const workspace = await updateWorkspace(params.id, {
      status: typeof body.status === "string" ? body.status : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    return ok({ workspace });
  } catch (err) {
    return serviceError(err, "workspace-update");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const deleted = await deleteWorkspace(params.id);
    return ok({ deleted });
  } catch (err) {
    return serviceError(err, "workspace-delete");
  }
}
