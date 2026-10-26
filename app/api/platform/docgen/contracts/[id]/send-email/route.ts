import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { DocGenError } from "@/lib/docgen/generate";
import { sendContractDocumentByEmail } from "@/lib/docgen/contracts";

/**
 * Email a contract's current PDF as an attachment (Send anywhere,
 * Oct 25, 2026): { recipients: [{ name, email }], subject? }.
 * The service enforces the SAME data-room restriction gate as the
 * signature channel and logs every attempt to docgen.document_sends.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const recipients = Array.isArray(body.recipients)
    ? (body.recipients as Array<Record<string, unknown>>).map((r) => ({
        name: typeof r.name === "string" ? r.name : "",
        email: typeof r.email === "string" ? r.email : "",
      }))
    : [];
  try {
    const result = await sendContractDocumentByEmail(
      params.id,
      {
        recipients,
        subject: typeof body.subject === "string" ? body.subject : undefined,
      },
      user.name || user.email
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof DocGenError) {
      const status =
        err.error === "contract_not_found" || err.error === "document_not_found"
          ? 404
          : err.error === "signer_not_approved_for_room"
            ? 403
            : err.error === "contract_executed"
              ? 409
              : 400;
      return NextResponse.json({ error: err.error }, { status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
