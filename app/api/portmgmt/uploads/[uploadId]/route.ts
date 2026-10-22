import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  serviceError,
} from "@/lib/portmgmt/http";
import {
  getUploadSession,
  appendPortalChunk,
  completePortalUpload,
  abortPortalUpload,
} from "@/lib/portmgmt/submissions";
import type { UploadSessionRow } from "@/lib/dataroom/uploads";

/**
 * Chunk / complete / abort for one upload session. Authorization: the
 * session row itself carries the companyId (set by beginUploadSession
 * from the gated begin call) — every operation loads the session and
 * company-gates THAT company, so a caller can never steer an upload
 * into a company they cannot access.
 */
type SessionGate =
  | { session: UploadSessionRow }
  | { response: NextResponse };

async function gateForSession(
  uploadId: string,
  actorEmail: string
): Promise<SessionGate> {
  void actorEmail;
  const session = await getUploadSession(uploadId);
  if (!session) {
    return {
      response: NextResponse.json(
        { error: "upload_not_found" },
        { status: 404, headers: { "Cache-Control": "private, no-store" } }
      ),
    };
  }
  return { session };
}

/** PUT one chunk. Offset via ?offset= or the x-upload-offset header. */
export async function PUT(
  req: NextRequest,
  { params }: { params: { uploadId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const actor = gate.user.name || gate.user.email;
  try {
    const found = await gateForSession(params.uploadId, gate.user.email);
    if ("response" in found) return found.response;
    const denied = companyGate(gate.ctx, found.session.companyId ?? "");
    if (denied) return denied;
    const offsetRaw =
      req.nextUrl.searchParams.get("offset") ??
      req.headers.get("x-upload-offset");
    const offset = offsetRaw !== null ? Number(offsetRaw) : NaN;
    if (!isFinite(offset) || offset < 0) {
      return NextResponse.json(
        { error: "invalid_offset" },
        { status: 400, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    const data = Buffer.from(await req.arrayBuffer());
    const result = await appendPortalChunk(
      params.uploadId,
      Math.trunc(offset),
      data,
      actor
    );
    return ok(result);
  } catch (err) {
    return serviceError(err, "uploads-chunk");
  }
}

/** POST complete the upload (hash + register the document). */
export async function POST(
  req: NextRequest,
  { params }: { params: { uploadId: string } }
): Promise<NextResponse> {
  void req;
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const actor = gate.user.name || gate.user.email;
  try {
    const found = await gateForSession(params.uploadId, gate.user.email);
    if ("response" in found) return found.response;
    const denied = companyGate(gate.ctx, found.session.companyId ?? "");
    if (denied) return denied;
    const result = await completePortalUpload(params.uploadId, actor);
    return ok({
      document: result.document,
      version: result.version,
      duplicateOf: result.duplicateOf,
    });
  } catch (err) {
    return serviceError(err, "uploads-complete");
  }
}

/** DELETE abort the upload session. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { uploadId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const actor = gate.user.name || gate.user.email;
  try {
    const found = await gateForSession(params.uploadId, gate.user.email);
    if ("response" in found) return found.response;
    const denied = companyGate(gate.ctx, found.session.companyId ?? "");
    if (denied) return denied;
    const aborted = await abortPortalUpload(params.uploadId, actor);
    return ok({ aborted });
  } catch (err) {
    return serviceError(err, "uploads-abort");
  }
}
