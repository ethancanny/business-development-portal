import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import {
  createEnvelopeForSource,
  listSigningEnvelopes,
  type SigningRecipientInput,
} from "@/lib/signing/service";

/**
 * Signing envelopes.
 * GET  ?documentId=&reportId=&dealId=&limit= → lean list (no token or
 *      access hashes, no blobs).
 * POST { documentId | reportId, recipients: [{ name, email,
 *        accessCode? }], signingOrder?, message?, expiresAt? }
 *      → 201 { envelope, signing, links } — links are one-time.
 */
export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit") ?? 25);
  const items = await listSigningEnvelopes({
    documentId: sp.get("documentId") ?? undefined,
    reportId: sp.get("reportId") ?? undefined,
    dealId: sp.get("dealId") ?? undefined,
    limit: Math.min(50, Math.max(1, isFinite(limitRaw) ? limitRaw : 25)),
  });
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const documentId =
    typeof body.documentId === "string" && body.documentId
      ? body.documentId
      : undefined;
  const reportId =
    typeof body.reportId === "string" && body.reportId
      ? body.reportId
      : undefined;
  if ((documentId && reportId) || (!documentId && !reportId)) {
    return NextResponse.json(
      {
        error: "source_required",
        detail: "Provide exactly one of documentId or reportId.",
      },
      { status: 400 }
    );
  }
  const rawRecipients = Array.isArray(body.recipients) ? body.recipients : [];
  const recipients: SigningRecipientInput[] = rawRecipients
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        name: typeof rec.name === "string" ? rec.name.trim() : "",
        email: typeof rec.email === "string" ? rec.email.trim() : "",
        accessCode:
          typeof rec.accessCode === "string" && rec.accessCode
            ? rec.accessCode
            : undefined,
      };
    })
    .filter((r) => r.email.includes("@"));
  if (!recipients.length) {
    return NextResponse.json(
      {
        error: "recipients_required",
        detail: "Provide at least one recipient with a valid email.",
      },
      { status: 400 }
    );
  }
  try {
    const result = await createEnvelopeForSource(
      {
        documentId,
        reportId,
        recipients,
        signingOrder: body.signingOrder === "parallel" ? "parallel" : "sequential",
        message: typeof body.message === "string" ? body.message : undefined,
        expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
        templateBlocks: body.templateBlocks,
      },
      { name: user.name || user.email, email: user.email }
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "document_not_found" || msg === "report_not_found") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (
      msg === "recipients_required" ||
      msg === "too_many_recipients" ||
      msg === "source_required" ||
      msg === "expires_at_invalid" ||
      msg === "report_pdf_not_found"
    ) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
