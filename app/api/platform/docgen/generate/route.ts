import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { DocGenError, generateDocument } from "@/lib/docgen/generate";

/**
 * Generate a document from a template for a deal.
 * POST { templateId | templateKey, dealId }
 * → 201 { documentId, documentName, version, roomId, unresolvedFields, … }
 * The PDF is registered in the document library (and placed in the
 * deal's data room when one exists).
 */
export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const templateId =
    typeof body.templateId === "string" ? body.templateId : undefined;
  const templateKey =
    typeof body.templateKey === "string" ? body.templateKey : undefined;
  const dealId = typeof body.dealId === "string" ? body.dealId : "";
  if (!dealId || (!templateId && !templateKey)) {
    return NextResponse.json(
      { error: "templateId or templateKey, and dealId are required" },
      { status: 400 }
    );
  }
  try {
    const result = await generateDocument({
      templateId,
      templateKey,
      dealId,
      actor: user.name || user.email,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof DocGenError) {
      const status =
        err.error === "template_not_found" || err.error === "deal_not_found"
          ? 404
          : 400;
      return NextResponse.json({ error: err.error }, { status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
