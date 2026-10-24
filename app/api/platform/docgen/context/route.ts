import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getTemplateById } from "@/lib/docgen/templates";
import {
  buildGenerationContext,
  reviewFieldsFor,
  templatePlainText,
} from "@/lib/docgen/contracts";
import { contractAiConfigured } from "@/lib/docgen/ai";

/**
 * Drafting context (contract generation, Oct 24, 2026): resolves the
 * merge-field values for a template + deal/investor/counterparty
 * selection so the drafting UI can render the field-by-field review
 * screen. GET ?templateId=&dealId=&investorPersonId=&commitmentId=
 * &counterpartyPersonId=
 */
export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const sp = req.nextUrl.searchParams;
  const templateId = sp.get("templateId") ?? "";
  if (!templateId) {
    return NextResponse.json(
      { error: "templateId is required" },
      { status: 400 }
    );
  }
  const template = await getTemplateById(templateId);
  if (!template) {
    return NextResponse.json(
      { error: "template_not_found" },
      { status: 404 }
    );
  }
  try {
    const gen = await buildGenerationContext({
      dealId: sp.get("dealId"),
      investorPersonId: sp.get("investorPersonId"),
      commitmentId: sp.get("commitmentId"),
      counterpartyPersonId: sp.get("counterpartyPersonId"),
    });
    const text = await templatePlainText(template);
    const fields = reviewFieldsFor(template, text, gen.context);
    return NextResponse.json({
      template: {
        id: template.id,
        key: template.key,
        name: template.name,
        version: template.version,
        status: template.status,
        scope: template.scope,
        sourceFormat: template.sourceFormat,
      },
      fields,
      companyId: gen.companyId,
      companyName: gen.companyName,
      dealId: gen.dealId,
      investorPersonId: gen.investorPersonId,
      investorName: gen.investorName,
      counterpartyPersonId: gen.counterpartyPersonId,
      counterparty: gen.counterparty,
      roomId: gen.roomId,
      commitments: gen.commitments,
      aiConfigured: contractAiConfigured(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "deal_not_found" || msg === "person_not_found" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
