import { NextRequest, NextResponse } from "next/server";
import { authed, serviceError, NO_STORE } from "@/lib/portmgmt/http";
import {
  buildStatementsTemplate,
  buildKpiTemplate,
} from "@/lib/portmgmt/templates";

/** GET download a submission template (kind: statements | kpis). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { kind: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  try {
    const tpl =
      params.kind === "statements"
        ? buildStatementsTemplate()
        : params.kind === "kpis"
          ? buildKpiTemplate()
          : null;
    if (!tpl) {
      return NextResponse.json(
        { error: "template_not_found" },
        { status: 404, headers: NO_STORE }
      );
    }
    return new NextResponse(new Uint8Array(tpl.bytes), {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": tpl.mime,
        "Content-Disposition": `attachment; filename="${tpl.filename}"`,
      },
    });
  } catch (err) {
    return serviceError(err, "templates-get");
  }
}
