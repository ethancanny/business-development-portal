import { PDFDocument } from "pdf-lib";
import {
  getDocument,
  getDocumentRooms,
  readDocumentBytes,
  registerUploadedDocument,
  sha256Hex,
} from "../dataroom/documents";
import { getStorageProvider } from "../storage";
import { sql, newId } from "../platform/db";
import { ensureSigningKey, getSigningKeyMaterial } from "./cert";
import {
  applySignatures,
  buildCertificateOfCompletion,
  signatureFieldRects,
  type SignatureField,
  type SignatureStamp,
} from "./pdf";
import { getEnvelopeFull, appendEvent, markCompleted } from "./service";
import { getGenerationSignatureBlocks } from "../docgen/generate";

/**
 * Envelope finalization (in-house e-signature build, Workstream B):
 * stamp every collected signature onto the prepared PDF, seal it with
 * the platform certificate (lib/signing/cert.ts) via @signpdf, file
 * the executed copy + a certificate of completion into the source
 * document's data room(s), and record completion through Workstream
 * A's service (markCompleted appends the `completed` event + notifies
 * the sender).
 *
 * Idempotent: an envelope whose executed_document_id is already set
 * returns its existing artifacts untouched (the internal retry route
 * and the sign-flow's finalizePending path rely on this).
 *
 * Field geometry: createEnvelopeForSource (A) persists prepared bytes
 * + fieldMode but not the field rects, so they are re-derived here —
 * template mode from the docgen generation's stored signature_blocks
 * for the source document; append mode from signatureFieldRects()
 * anchored to the prepared document's last page(s). If the prepared
 * copy never got its signature page (A's prepare fallback: prepared
 * hash == source hash), the page is appended now via prepareDocument.
 *
 * Failure law: any error appends a `finalize_failed` event with the
 * message and is rethrown — nothing is ever half-reported completed.
 */

export interface FinalizeResult {
  envelopeId: string;
  status: "completed";
  executedDocumentId: string;
  certificateDocumentId: string;
  executedSha256: string;
}

async function loadDocBytes(documentId: string): Promise<{
  name: string;
  dealId: string | null;
  companyId: string | null;
  bytes: Buffer;
}> {
  const doc = await getDocument(documentId);
  if (!doc) throw new Error("document_not_found");
  const read = await readDocumentBytes(doc);
  return {
    name: doc.name,
    dealId: doc.dealId,
    companyId: doc.companyId,
    bytes: read.bytes,
  };
}

/** Register PDF bytes as a new library document (generate.ts pattern). */
async function registerPdf(input: {
  bytes: Buffer;
  filename: string;
  actor: string;
  dealId: string | null;
  companyId: string | null;
  tags: string[];
  tempPrefix: string;
  roomId?: string | null;
  folderId?: string | null;
}): Promise<string> {
  const tempKey = `uploads/${input.tempPrefix}-${newId()}.pdf`;
  await getStorageProvider().put(tempKey, input.bytes);
  const { document } = await registerUploadedDocument({
    storageKey: tempKey,
    filename: input.filename,
    mime: "application/pdf",
    sizeBytes: input.bytes.length,
    contentHash: sha256Hex(input.bytes),
    actor: input.actor,
    dealId: input.dealId,
    companyId: input.companyId,
    tags: input.tags,
    roomId: input.roomId ?? null,
    folderId: input.folderId ?? null,
  });
  return document.id;
}

/** File a document into the remaining rooms (past the first, which
 * registerUploadedDocument handled), preserving folder placement —
 * the dataroom.room_documents insert from documents.ts. */
async function linkIntoRooms(
  documentId: string,
  rooms: Array<{ roomId: string; folderId: string | null }>,
  actor: string
): Promise<void> {
  if (rooms.length <= 1) return;
  const db = sql();
  for (const room of rooms.slice(1)) {
    await db`
      INSERT INTO dataroom.room_documents (id, room_id, folder_id, document_id, added_by)
      VALUES (${newId()}, ${room.roomId}, ${room.folderId}, ${documentId}, ${actor})
      ON CONFLICT (room_id, document_id) DO NOTHING`;
  }
}

export async function finalizeEnvelope(
  envelopeId: string
): Promise<FinalizeResult> {
  const full = await getEnvelopeFull(envelopeId);
  if (!full) throw new Error("envelope_not_found");
  const signing = full.signing;

  // Idempotent: already completed → return the existing artifacts.
  if (signing.executedDocumentId) {
    return {
      envelopeId,
      status: "completed",
      executedDocumentId: signing.executedDocumentId,
      certificateDocumentId: signing.certificateDocumentId ?? "",
      executedSha256: signing.executedSha256,
    };
  }

  try {
    if (signing.voidedAt) throw new Error("envelope_not_live");
    const signers = [...full.signers].sort(
      (a, b) => a.orderIndex - b.orderIndex
    );
    if (!signers.length || signers.some((s) => s.status !== "signed")) {
      throw new Error("not_all_signed");
    }
    if (!signing.preparedDocumentId) {
      throw new Error("prepared_document_missing");
    }

    const source = await loadDocBytes(signing.documentId);
    const preparedDoc = await getDocument(signing.preparedDocumentId);
    if (!preparedDoc) throw new Error("document_not_found");
    const preparedRead = await readDocumentBytes(preparedDoc);
    let preparedBytes: Buffer = preparedRead.bytes;

    /* ---- derive the signature fields (see header note) ---- */
    let fields: SignatureField[] | null = null;
    if (signing.fieldMode === "template") {
      const blocks = await getGenerationSignatureBlocks(signing.documentId);
      if (blocks && blocks.length === signers.length) {
        fields = blocks.map((b, i) => ({
          signerIndex: i,
          page: b.page,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
        }));
      }
    }
    if (!fields) {
      if (
        signing.fieldMode === "append" &&
        signing.preparedSha256 &&
        signing.preparedSha256 === signing.sourceSha256
      ) {
        // A's prepare fallback filed the untouched source as the
        // prepared copy — append the signature page now.
        const { prepareDocument } = await import("./pdf");
        const prep = await prepareDocument({
          sourceBytes: preparedBytes,
          signers: signers.map((s) => ({ name: s.name, email: s.email })),
          presetBlocks: null,
        });
        preparedBytes = prep.bytes;
        fields = prep.fields;
      } else {
        const preparedPdf = await PDFDocument.load(preparedBytes);
        const rects = signatureFieldRects(signers.length);
        const sigPages = rects.length
          ? Math.max(...rects.map((r) => r.page)) + 1
          : 0;
        const offset = preparedPdf.getPageCount() - sigPages;
        if (offset < 0) throw new Error("prepared_document_page_mismatch");
        fields = rects.map((r) => ({
          signerIndex: r.roleIndex,
          page: offset + r.page,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        }));
      }
    }

    /* ---- stamp the collected signatures ---- */
    const provider = getStorageProvider();
    const stamps: SignatureStamp[] = [];
    for (const signer of signers) {
      const kind = signer.signatureKind === "drawn" ? "drawn" : "typed";
      let pngBytes: Buffer | undefined;
      if (kind === "drawn" && signer.signatureObjectKey) {
        pngBytes = await provider.get(signer.signatureObjectKey);
      }
      stamps.push({
        kind,
        typedName: signer.typedName || signer.name,
        pngBytes,
        signerName: signer.name,
        signedAtIso: signer.signedAt ?? undefined,
      });
    }
    const stamped = await applySignatures(preparedBytes, fields, stamps);

    /* ---- seal with the platform certificate ---- */
    await ensureSigningKey();
    const { p12Buffer, passphrase } = await getSigningKeyMaterial();
    const { PDFDocument: SealDoc } = await import("pdf-lib");
    const sealInput = await SealDoc.load(stamped);
    const placeholderMod = (await import(
      "@signpdf/placeholder-pdf-lib"
    )) as unknown as {
      pdflibAddPlaceholder: (input: {
        pdfDoc: unknown;
        reason: string;
        contactInfo: string;
        name: string;
        location: string;
      }) => void;
    };
    placeholderMod.pdflibAddPlaceholder({
      pdfDoc: sealInput,
      reason: "Executed via Canny Capital Portal",
      contactInfo: signing.senderEmail,
      name: "Canny Capital Partners",
      location: "Phoenix, Arizona",
    });
    const withPlaceholder = Buffer.from(await sealInput.save());
    const signpdfMod = (await import("@signpdf/signpdf")) as unknown as {
      SignPdf: new () => {
        sign: (pdf: Buffer, signer: unknown) => Promise<Buffer>;
      };
    };
    const signerMod = (await import("@signpdf/signer-p12")) as unknown as {
      P12Signer: new (
        p12: Buffer,
        opts: { passphrase: string }
      ) => unknown;
    };
    const sealed = await new signpdfMod.SignPdf().sign(
      withPlaceholder,
      new signerMod.P12Signer(p12Buffer, { passphrase })
    );
    const executedSha256 = sha256Hex(sealed);
    const completedAtIso = new Date().toISOString();

    /* ---- file executed copy + certificate into the source rooms ---- */
    const rooms = await getDocumentRooms(signing.documentId);
    const firstRoom = rooms.length ? rooms[0] : null;
    const actor = signing.senderName || "system";
    const dealId = signing.dealId ?? source.dealId;
    const companyId = signing.companyId ?? source.companyId;
    const baseName = source.name.replace(/\.[A-Za-z0-9]{1,8}$/, "");

    const executedDocumentId = await registerPdf({
      bytes: sealed,
      filename: `${baseName} (Executed).pdf`,
      actor,
      dealId,
      companyId,
      tags: ["executed", "signed"],
      tempPrefix: "signing-executed",
      roomId: firstRoom?.roomId ?? null,
      folderId: firstRoom?.folderId ?? null,
    });
    await linkIntoRooms(executedDocumentId, rooms, actor);

    const certificateBytes = buildCertificateOfCompletion({
      envelopeId,
      documentName: source.name,
      sourceSha256: signing.sourceSha256 || sha256Hex(source.bytes),
      preparedSha256: signing.preparedSha256 || sha256Hex(preparedBytes),
      executedSha256,
      completedAtIso,
      senderName: signing.senderName,
      senderEmail: signing.senderEmail,
      signers: signers.map((s) => ({
        name: s.name,
        email: s.email,
        ip: s.ip,
        userAgent: s.userAgent,
        consentAt: s.consentAt,
        viewedAt: s.viewedAt,
        signedAt: s.signedAt,
        signatureKind: s.signatureKind || "typed",
        accessCodeUsed: s.hasAccessCode,
      })),
      events: full.events.map((e) => ({
        kind: e.kind,
        at: e.createdAt,
        actor: e.actor,
      })),
    });
    const certificateDocumentId = await registerPdf({
      bytes: certificateBytes,
      filename: `${baseName} — Certificate of Completion.pdf`,
      actor,
      dealId,
      companyId,
      tags: ["certificate", "signed"],
      tempPrefix: "signing-cert",
      roomId: firstRoom?.roomId ?? null,
      folderId: firstRoom?.folderId ?? null,
    });
    await linkIntoRooms(certificateDocumentId, rooms, actor);

    await appendEvent(envelopeId, {
      kind: "sealed",
      actor: "system",
      detail: { executedSha256 },
    });
    await markCompleted(envelopeId, {
      executedDocumentId,
      certificateDocumentId,
      executedSha256,
    });

    return {
      envelopeId,
      status: "completed",
      executedDocumentId,
      certificateDocumentId,
      executedSha256,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await appendEvent(envelopeId, {
        kind: "finalize_failed",
        actor: "system",
        detail: { message },
      });
    } catch {
      /* the original error is the one that matters */
    }
    throw err;
  }
}
