import { NextRequest, NextResponse } from "next/server";
import { authed, ok, serviceError } from "@/lib/capital/http";
import { getDealTemplateGroups } from "@/lib/capital/documents";

/** GET the type-relevant docgen template groups for this deal's
 * Documents tab: { groups: [{ key, label, templates: [{ id, name,
 * key, status }] }], typeKey }. Generation itself stays with docgen
 * (approved templates only). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const result = await getDealTemplateGroups(params.dealId);
    return ok(result);
  } catch (err) {
    return serviceError(err, "deal-templates");
  }
}
