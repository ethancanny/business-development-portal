import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getDocument, readDocumentBytes } from "@/lib/dataroom/documents";
import { StorageNotFoundError } from "@/lib/storage/types";
import {
  NO_STORE,
  jsonNoStore,
  resolveSigner,
} from "@/app/api/sign/shared";

/**
 * PUBLIC signer document stream — NO session; the token is the
 * credential. Serves the envelope's PREPARED PDF (signature blocks
 * appended), or the EXECUTED PDF once the envelope completes.
 * Allowed for states waiting / active / signed / completed (a
 * waiting sequential signer may VIEW — they just can't sign yet);
 * 403 for voided / declined / expired. Inline, private, no-store.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  headers();
  try {
    const outcome = await resolveSigner(params.token);
    if (!outcome.ok) {
      return jsonNoStore({ error: "not_found" }, { status: 404 });
    }
    const v = outcome.view;
    if (
      v.state === "voided" ||
      v.state === "declined" ||
      v.state === "expired"
    ) {
      return jsonNoStore({ error: v.state }, { status: 403 });
    }

    const documentId =
      v.state === "completed" && v.executedDocumentId
        ? v.executedDocumentId
        : v.preparedDocumentId || v.documentId;
    if (!documentId) {
      return jsonNoStore({ error: "not_found" }, { status: 404 });
    }
    const doc = await getDocument(documentId);
    if (!doc) {
      return jsonNoStore({ error: "not_found" }, { status: 404 });
    }
    const { bytes } = await readDocumentBytes(doc);
    const filename =
      v.state === "completed"
        ? `${v.documentName.replace(/\.pdf$/i, "")} (executed).pdf`
        : doc.name || `${v.documentName}.pdf`;
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      return jsonNoStore({ error: "bytes_unavailable" }, { status: 404 });
    }
    console.error(
      "[sign:document]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500, headers: NO_STORE }
    );
  }
}
