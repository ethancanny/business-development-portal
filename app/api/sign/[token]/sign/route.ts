import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkAccessCode, recordSignature } from "@/lib/signing/service";
import { getStorageProvider } from "@/lib/storage";
import {
  NO_STORE,
  clientIp,
  jsonNoStore,
  normalizeAccessResult,
  resolveFailure,
  resolveSigner,
  tooManyFailures,
  userAgent,
} from "@/app/api/sign/shared";

/**
 * PUBLIC signer signature submission — NO session; the token is the
 * credential. Order of gates (per brief): rate limit → access code
 * (counted attempt, FIRST when required) → consent (409
 * consent_required) → signature validation → recordSignature. A
 * drawn signature's PNG is validated (base64, PNG magic, ~200 KB
 * cap) and stored via the storage provider at
 * signing/<envelopeId>/<signerId>.png; a typed name must share a
 * name token with the signer's name. When the last signer signs,
 * finalizeEnvelope (Workstream B) is dynamic-imported and awaited —
 * if it fails, the sign still stands and the sender gets a finalize
 * retry (finalizePending).
 */
export const dynamic = "force-dynamic";

const MAX_PNG_BYTES = 200 * 1024;

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 2);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  headers();
  try {
    const outcome = await resolveSigner(params.token);
    if (!outcome.ok) return resolveFailure(outcome);
    const v = outcome.view;
    if (v.state !== "active") {
      return jsonNoStore(
        { error: "not_active", state: v.state },
        { status: 409 }
      );
    }
    if (await tooManyFailures(v.envelopeId)) {
      return jsonNoStore({ error: "rate_limited" }, { status: 429 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const kind = body.kind === "drawn" ? "drawn" : body.kind === "typed" ? "typed" : "";
    if (!kind) {
      return jsonNoStore({ error: "kind_required" }, { status: 400 });
    }

    // Access code gate — checked (and the attempt counted) FIRST.
    if (v.requiresAccessCode) {
      const code =
        typeof body.accessCode === "string" ? body.accessCode : "";
      if (!code) {
        return jsonNoStore({ error: "access_code_required" }, { status: 401 });
      }
      const check = normalizeAccessResult(
        await checkAccessCode(v.signerId, code, true)
      );
      if (check.locked) {
        return jsonNoStore(
          { error: "access_code_locked", attemptsLeft: check.attemptsLeft },
          { status: 423 }
        );
      }
      if (!check.ok) {
        return jsonNoStore(
          { error: "access_code_invalid", attemptsLeft: check.attemptsLeft },
          { status: 401 }
        );
      }
    }

    // Consent gate.
    if (!v.consented) {
      return jsonNoStore({ error: "consent_required" }, { status: 409 });
    }

    let typedName = "";
    let signatureObjectKey = "";
    if (kind === "typed") {
      typedName =
        typeof body.typedName === "string" ? body.typedName.trim() : "";
      const typedTokens = nameTokens(typedName);
      const signerTokens = nameTokens(v.signerName);
      const shares =
        typedTokens.length > 0 &&
        typedTokens.some((t) => signerTokens.indexOf(t) >= 0);
      if (!typedName || !shares) {
        return jsonNoStore({ error: "typed_name_mismatch" }, { status: 400 });
      }
    } else {
      const b64 =
        typeof body.signaturePngBase64 === "string"
          ? body.signaturePngBase64
          : "";
      const raw = b64.replace(/^data:image\/png;base64,/, "").trim();
      if (!raw) {
        return jsonNoStore({ error: "signature_required" }, { status: 400 });
      }
      let bytes: Buffer;
      try {
        bytes = Buffer.from(raw, "base64");
      } catch {
        return jsonNoStore({ error: "signature_invalid" }, { status: 400 });
      }
      if (bytes.length === 0 || bytes.length > MAX_PNG_BYTES) {
        return jsonNoStore(
          { error: "signature_too_large", maxBytes: MAX_PNG_BYTES },
          { status: 400 }
        );
      }
      // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      const isPng =
        bytes.length > 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47;
      if (!isPng) {
        return jsonNoStore({ error: "signature_invalid" }, { status: 400 });
      }
      signatureObjectKey = `signing/${v.envelopeId}/${v.signerId}.png`;
      await getStorageProvider().put(signatureObjectKey, bytes);
    }

    const result = (await recordSignature(v.signerId, {
      kind,
      typedName: kind === "typed" ? typedName : undefined,
      signatureObjectKey: kind === "drawn" ? signatureObjectKey : undefined,
      ip: clientIp(req),
      ua: userAgent(req),
    })) as { envelopeStatus?: string; allSigned?: boolean } | null;

    const allSigned = result?.allSigned === true;
    let envelopeStatus =
      typeof result?.envelopeStatus === "string" && result.envelopeStatus
        ? result.envelopeStatus
        : allSigned
          ? "completed"
          : "partially_signed";

    if (allSigned) {
      try {
        const mod = (await import("@/lib/signing/finalize")) as {
          finalizeEnvelope: (envelopeId: string) => Promise<unknown>;
        };
        await mod.finalizeEnvelope(v.envelopeId);
        envelopeStatus = "completed";
      } catch (finErr) {
        console.error(
          "[sign:sign] finalize failed",
          finErr instanceof Error ? finErr.message : String(finErr)
        );
        return jsonNoStore({
          ok: true,
          envelopeStatus: "partially_signed",
          finalizePending: true,
        });
      }
    }

    return jsonNoStore({ ok: true, envelopeStatus });
  } catch (err) {
    console.error(
      "[sign:sign]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500, headers: NO_STORE }
    );
  }
}
