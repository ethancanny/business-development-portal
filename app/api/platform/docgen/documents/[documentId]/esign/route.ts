import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getDocument } from "@/lib/dataroom/documents";
import {
  EsignNotImplementedError,
  EsignSetupRequiredError,
  getEsignStatus,
  getLatestEnvelope,
  listEnvelopes,
  requestEnvelope,
  type EsignRecipient,
} from "@/lib/docgen/esign";

/**
 * E-signature for one document (framework — no live provider).
 * GET  → provider status + latest envelope + envelope history.
 * POST { recipients: [{ name, email }] } → create envelope. While
 * DocuSign is unconfigured this persists an envelope row with status
 * "setup_required" and returns 409 { error: "setup_required",
 * missing, detail } — it NEVER fakes a sent state.
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
  return NextResponse.json({ provider, envelope, envelopes });
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
  const document = await getDocument(params.documentId);
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  try {
    const { envelope } = await requestEnvelope({
      documentId: params.documentId,
      recipients,
      actor: user.name || user.email,
    });
    return NextResponse.json({ envelope }, { status: 201 });
  } catch (err) {
    if (err instanceof EsignSetupRequiredError) {
      const envelope = (
        err as EsignSetupRequiredError & { envelope?: unknown }
      ).envelope;
      return NextResponse.json(
        {
          error: "setup_required",
          missing: err.missing,
          detail: err.message,
          envelope,
        },
        { status: 409 }
      );
    }
    if (err instanceof EsignNotImplementedError) {
      const envelope = (
        err as EsignNotImplementedError & { envelope?: unknown }
      ).envelope;
      return NextResponse.json(
        { error: err.code, detail: err.message, envelope },
        { status: 501 }
      );
    }
    if (err instanceof Error && err.message === "document_not_found") {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
