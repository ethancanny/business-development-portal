import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { DocGenError } from "@/lib/docgen/generate";
import {
  generateContract,
  listContracts,
} from "@/lib/docgen/contracts";

function errorStatus(code: string): number {
  if (
    code === "template_not_found" ||
    code === "deal_not_found" ||
    code === "contract_not_found" ||
    code === "document_not_found"
  ) {
    return 404;
  }
  if (code === "template_not_approved" || code === "ai_not_configured") {
    return 409;
  }
  if (code === "signer_not_approved_for_room") return 403;
  return 400;
}

/** Contracts: list (GET, filter by companyId / dealId /
 * investorPersonId) and generate (POST). Generation requires an
 * approved template; the reviewed field values + key dates come from
 * the drafting review screen. */
export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const sp = req.nextUrl.searchParams;
  const { items, total } = await listContracts({
    companyId: sp.get("companyId") ?? undefined,
    dealId: sp.get("dealId") ?? undefined,
    investorPersonId: sp.get("investorPersonId") ?? undefined,
    limit: Number(sp.get("limit") ?? 25) || 25,
    offset: Number(sp.get("offset") ?? 0) || 0,
  });
  return NextResponse.json(
    { contracts: items, total },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const templateId = typeof body.templateId === "string" ? body.templateId : "";
  if (!templateId) {
    return NextResponse.json(
      { error: "templateId is required" },
      { status: 400 }
    );
  }
  const fieldValues: Record<string, string> = {};
  if (body.fieldValues && typeof body.fieldValues === "object") {
    for (const [k, v] of Object.entries(
      body.fieldValues as Record<string, unknown>
    )) {
      if (typeof v === "string") fieldValues[k] = v;
    }
  }
  const kd =
    body.keyDates && typeof body.keyDates === "object"
      ? (body.keyDates as Record<string, unknown>)
      : {};
  const dateOrNull = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 10) : null;
  try {
    const result = await generateContract({
      templateId,
      dealId: typeof body.dealId === "string" ? body.dealId : null,
      investorPersonId:
        typeof body.investorPersonId === "string" ? body.investorPersonId : null,
      commitmentId:
        typeof body.commitmentId === "string" ? body.commitmentId : null,
      counterpartyPersonId:
        typeof body.counterpartyPersonId === "string"
          ? body.counterpartyPersonId
          : null,
      fieldValues,
      keyDates: {
        exclusivityExpiry: dateOrNull(kd.exclusivityExpiry),
        closing: dateOrNull(kd.closing),
        renewal: dateOrNull(kd.renewal),
      },
      actor: user.name || user.email,
      actorEmail: user.email,
    });
    return NextResponse.json(
      {
        contract: result.contract,
        version: result.version,
        docxDocumentId: result.docxDocumentId,
        pdfDocumentId: result.pdfDocumentId,
        roomId: result.roomId,
        unresolvedFields: result.unresolvedFields,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof DocGenError) {
      return NextResponse.json(
        { error: err.error },
        { status: errorStatus(err.error) }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
