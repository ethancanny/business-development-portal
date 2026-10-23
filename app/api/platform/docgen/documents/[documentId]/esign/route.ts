import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getDocument } from "@/lib/dataroom/documents";
import {
  getEsignStatus,
  getLatestEnvelope,
  listEnvelopes,
  requestEnvelope,
  type EsignRecipient,
} from "@/lib/docgen/esign";
import { listSigningEnvelopes } from "@/lib/signing/service";

/**
 * E-signature for one document (in-house signing module).
 * GET  → provider status + latest envelope + envelope history +
 *        the latest envelope's signing summary when one exists.
 * POST { recipients: [{ name, email, accessCode? }], signingOrder?,
 *        message?, expiresAt? }
 *      → 201 { envelope, signing, links } — links are the one-time
 *        signer URLs (/sign/<token>), returned only in this response.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { documentId: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const document = await getDocument(params.documentId);
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const [provider, envelope, envelopes] = await Promise.all([
    getEsignStatus(),
    getLatestEnvelope(params.documentId),
    listEnvelopes(params.documentId),
  ]);
  let signing = null;
  if (envelope) {
    const list = await listSigningEnvelopes({
      documentId: params.documentId,
      limit: 25,
    }).catch(() => []);
    signing = list.find((s) => s.id === envelope.id) ?? null;
  }
  return NextResponse.json({ provider, envelope, envelopes, signing });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { documentId: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const rawRecipients = Array.isArray(body.recipients) ? body.recipients : [];
  const recipients: EsignRecipient[] = rawRecipients
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
  const signingOrder =
    body.signingOrder === "parallel" ? "parallel" : "sequential";
  const message =
    typeof body.message === "string" ? body.message : undefined;
  const expiresAt =
    typeof body.expiresAt === "string" ? body.expiresAt : null;
  const document = await getDocument(params.documentId);
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  try {
    const { envelope, signing, links } = await requestEnvelope({
      documentId: params.documentId,
      recipients,
      actor: user.name || user.email,
      actorEmail: user.email,
      signingOrder,
      message,
      expiresAt,
      templateBlocks: body.templateBlocks,
    });
    return NextResponse.json({ envelope, signing, links }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "document_not_found") {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (
      err instanceof Error &&
      (err.message === "recipients_required" ||
        err.message === "too_many_recipients" ||
        err.message === "expires_at_invalid")
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
