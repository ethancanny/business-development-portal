import { NextRequest, NextResponse } from "next/server";
import { authed, ok, readBody, serviceError } from "@/lib/diligence/http";
import { enqueueJob } from "@/lib/platform/jobs";
import { runExtraction } from "@/lib/docint/service";

/**
 * POST { dealId, documentId, sync? } — extract contract terms from a
 * document. With sync=true the extraction runs inline and the run is
 * returned; otherwise an "extract_document_terms" job is enqueued.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const body = await readBody(req);
    const dealId = typeof body.dealId === "string" ? body.dealId : "";
    const documentId =
      typeof body.documentId === "string" ? body.documentId : "";
    if (!dealId) return ok({ error: "deal_id_required" }, 400);
    if (!documentId) return ok({ error: "document_id_required" }, 400);
    const actor = gate.user.name;
    if (body.sync === true) {
      const run = await runExtraction({
        dealId,
        documentId,
        actor,
        triggerSource: "manual",
      });
      return ok({ run }, 201);
    }
    const jobId = await enqueueJob("extract_document_terms", {
      dealId,
      documentId,
      actor,
      triggerSource: "manual",
    });
    return ok({ enqueued: true, jobId });
  } catch (err) {
    return serviceError(err, "docint-extract");
  }
}
