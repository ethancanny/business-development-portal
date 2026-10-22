import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  companyGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/portmgmt/http";
import { submitDocument, listSubmissions } from "@/lib/portmgmt/submissions";
import { listDocuments } from "@/lib/dataroom/documents";

/** GET the company's library documents (via the dataroom documents
 * service, filtered by companyId) + its portal submissions ledger. */
export async function GET(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  try {
    const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
    const { items, total } = await listDocuments({
      companyId: params.companyId,
      limit: isFinite(rawLimit) ? rawLimit : 50,
    });
    const submissions = await listSubmissions(params.companyId);
    return ok({ documents: items, total, submissions });
  } catch (err) {
    return serviceError(err, "company-documents-get");
  }
}

/** POST record a document submission. Body: { documentId, kind? } —
 * the document itself was uploaded through the uploads flow. */
export async function POST(
  req: NextRequest,
  { params }: { params: { companyId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = companyGate(gate.ctx, params.companyId);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    const submission = await submitDocument(
      params.companyId,
      { documentId: sStr(body.documentId) ?? "", kind: sStr(body.kind) },
      actor
    );
    return ok({ submission }, 201);
  } catch (err) {
    return serviceError(err, "company-documents-post");
  }
}
