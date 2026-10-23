import { NextRequest, NextResponse } from "next/server";
import {
  getEnvelopeFull,
  resolveSignerToken,
} from "@/lib/signing/service";
import { getDocument } from "@/lib/dataroom/documents";

/**
 * Shared helpers for the PUBLIC signer API (/api/sign/[token]/**).
 *
 * Signer-handler rules (Phase 3/12 law, hard): NO session auth — the
 * signer token in the path is the ONLY credential and the session
 * cookie is never read here. Every handler reads headers() first
 * (per-request dynamic execution, so revocation/voiding takes effect
 * immediately), is force-dynamic, and answers Cache-Control
 * private, no-store. Only envelope data for THIS signer is ever
 * returned — no other portal data crosses this surface.
 *
 * Service contract (lib/signing/service, Workstream A):
 * resolveSignerToken returns { ok:true, signer, envelope: signingRow,
 * signing: signingRow, docgen: docgenRow, docgenStatus, status,
 * documentName } or { ok:false, error, signer?, envelope?, signing?,
 * docgen?, status? } for expired/voided/declined (those variants
 * carry the full rows, minus documentName). The ENVELOPE STATUS is
 * the docgen status (root `status`/`docgenStatus`); the signing row
 * itself carries prepared/executed document ids, sender, order and
 * expiry. The resolve payload has no signer LIST — position/total
 * and sequential-waiting are derived from getEnvelopeFull's signers.
 */

export const NO_STORE = { "Cache-Control": "private, no-store" };

export function jsonNoStore(
  body: unknown,
  init?: { status?: number }
): NextResponse {
  const res = NextResponse.json(body, init ?? {});
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "";
}

export function userAgent(req: NextRequest): string {
  return req.headers.get("user-agent") || "";
}

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec {
  return v && typeof v === "object" ? (v as Rec) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function bool(v: unknown): boolean {
  return v === true;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function pick(r: Rec, ...keys: string[]): unknown {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return r[k];
  }
  return undefined;
}

export interface SignerView {
  signerId: string;
  signerName: string;
  signerEmail: string;
  signerStatus: string;
  consented: boolean;
  requiresAccessCode: boolean;
  accessLocked: boolean;
  attemptsLeft: number | null;
  envelopeId: string;
  envelopeStatus: string;
  documentId: string | null;
  preparedDocumentId: string | null;
  executedDocumentId: string | null;
  certificateDocumentId: string | null;
  documentName: string;
  senderName: string;
  senderEmail: string;
  signingOrder: "sequential" | "parallel";
  expiresAt: string | null;
  position: number;
  totalSigners: number;
  /** Normalized signer state for the public surface. */
  state:
    | "waiting"
    | "active"
    | "signed"
    | "completed"
    | "declined"
    | "voided"
    | "expired";
}

export type ResolveOutcome =
  | { ok: true; view: SignerView }
  | { ok: false; error: "not_found" };

function isPast(iso: string | null): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t < Date.now();
}

function signerStatusSigned(s: string): boolean {
  const v = s.toLowerCase();
  return v === "signed" || v === "completed" || v === "complete";
}

/**
 * Resolve a signer token through Workstream A's service and
 * normalize the result into the public view. Expired / voided /
 * declined variants still carry the signer + envelope rows, so they
 * resolve to a view with the matching terminal state (the GET route
 * renders them informationally; expired answers 410). Only a truly
 * unknown token resolves to not_found.
 */
export async function resolveSigner(
  token: string
): Promise<ResolveOutcome> {
  const raw: unknown = await resolveSignerToken(token);
  if (!raw) return { ok: false, error: "not_found" };
  const root = rec(raw);
  const resolveError = root.ok === false ? str(pick(root, "error")) : "";
  if (resolveError === "not_found") return { ok: false, error: "not_found" };
  if (root.ok === false && !pick(root, "envelope") && !pick(root, "signer")) {
    return { ok: false, error: "not_found" };
  }

  const signer = rec(pick(root, "signer", "signerRow"));
  // Per the A contract, `envelope` IS the signing row; `docgen` is
  // the provider-agnostic envelope row that carries the status.
  const signing = rec(pick(root, "signing") ?? pick(root, "envelope"));
  const docgen = rec(pick(root, "docgen"));
  const envelopeId = str(
    pick(signing, "envelopeId", "envelope_id", "id") ??
      pick(docgen, "id") ??
      pick(signer, "envelopeId", "envelope_id")
  );
  const envelopeStatus = str(
    pick(root, "status", "docgenStatus") ??
      pick(docgen, "status") ??
      pick(signing, "status")
  ).toLowerCase();

  const signerId = str(pick(signer, "id", "signerId"));
  const signerStatus = str(pick(signer, "status")).toLowerCase();
  const expiresRaw =
    (pick(signing, "expiresAt", "expires_at") as string | null) ??
    (pick(docgen, "expiresAt", "expires_at") as string | null) ??
    null;
  const expiresIso =
    typeof expiresRaw === "string" && expiresRaw ? expiresRaw : null;

  const signingOrderRaw = str(
    pick(signing, "signingOrder", "signing_order") ??
      pick(docgen, "signingOrder", "signing_order")
  ).toLowerCase();
  const signingOrder: "sequential" | "parallel" =
    signingOrderRaw === "parallel" ? "parallel" : "sequential";

  const documentId =
    (pick(signing, "documentId", "document_id") as string | null) ??
    (pick(docgen, "documentId", "document_id") as string | null) ??
    null;

  // Signer list: the resolve payload carries none, so derive
  // position / total / sequential-waiting from the full read.
  let signers: Rec[] = [];
  const signersRaw = pick(root, "signers");
  if (Array.isArray(signersRaw)) {
    signers = signersRaw as Rec[];
  } else if (envelopeId) {
    try {
      const full = rec(await getEnvelopeFull(envelopeId));
      const fullSigners = pick(full, "signers");
      if (Array.isArray(fullSigners)) signers = fullSigners as Rec[];
    } catch {
      /* position/total fall back to the signer's own orderIndex */
    }
  }

  // Position: 1-based. The service's orderIndex is 0-based.
  let position = 0;
  const oi = numOrNull(pick(signer, "orderIndex", "order_index"));
  if (oi !== null && oi >= 0) position = oi + 1;
  if (signers.length > 0 && signerId) {
    const idx = signers.findIndex(
      (s) => str(pick(s, "id", "signerId")) === signerId
    );
    if (idx >= 0) position = idx + 1;
  }
  if (position <= 0) position = 1;
  const totalSigners = signers.length > 0 ? signers.length : 1;

  const consented =
    bool(pick(signer, "consented")) ||
    !!pick(signer, "consentedAt", "consented_at", "consentAt", "consent_at");
  const requiresAccessCode =
    bool(
      pick(signer, "requiresAccessCode", "accessCodeRequired", "hasAccessCode")
    ) || !!pick(signer, "accessCodeHash", "access_code_hash");

  const preparedDocumentId =
    (pick(signing, "preparedDocumentId", "prepared_document_id") as
      | string
      | null) ?? null;
  const executedDocumentId =
    (pick(signing, "executedDocumentId", "executed_document_id") as
      | string
      | null) ?? null;

  // Document name: present on the ok variant's root; the terminal
  // variants omit it, so look it up from the document record.
  let documentName =
    str(pick(root, "documentName", "document_name")) ||
    str(pick(signing, "documentName", "document_name"));
  if (!documentName && documentId) {
    try {
      const doc = await getDocument(documentId);
      documentName = doc?.name ?? "";
    } catch {
      documentName = "";
    }
  }

  // ---- state derivation ----
  let state: SignerView["state"];
  if (resolveError === "voided" || envelopeStatus === "voided" || signing.voidedAt) {
    state = "voided";
  } else if (
    resolveError === "declined" ||
    envelopeStatus === "declined" ||
    signerStatus === "declined"
  ) {
    state = "declined";
  } else if (
    envelopeStatus === "completed" ||
    envelopeStatus === "complete" ||
    envelopeStatus === "executed"
  ) {
    state = "completed";
  } else if (
    resolveError === "expired" ||
    envelopeStatus === "expired" ||
    (isPast(expiresIso) && !signerStatusSigned(signerStatus))
  ) {
    state = "expired";
  } else if (signerStatusSigned(signerStatus)) {
    state = "signed";
  } else if (signingOrder === "sequential" && signers.length > 0) {
    const myIdx = position - 1;
    const earlierUnsigned = signers
      .slice(0, Math.max(0, myIdx))
      .some((s) => !signerStatusSigned(str(pick(s, "status"))));
    state = earlierUnsigned ? "waiting" : "active";
  } else if (signingOrder === "sequential" && signerStatus === "pending") {
    state = "waiting";
  } else {
    state = "active";
  }

  return {
    ok: true,
    view: {
      signerId,
      signerName: str(pick(signer, "name")),
      signerEmail: str(pick(signer, "email")),
      signerStatus,
      consented,
      requiresAccessCode,
      accessLocked: bool(pick(signer, "accessLocked", "locked")),
      attemptsLeft: numOrNull(pick(signer, "attemptsLeft", "attempts_left")),
      envelopeId,
      envelopeStatus,
      documentId,
      preparedDocumentId:
        typeof preparedDocumentId === "string" && preparedDocumentId
          ? preparedDocumentId
          : null,
      executedDocumentId:
        typeof executedDocumentId === "string" && executedDocumentId
          ? executedDocumentId
          : null,
      certificateDocumentId:
        (pick(signing, "certificateDocumentId", "certificate_document_id") as
          | string
          | null) ?? null,
      documentName: documentName || "Document",
      senderName: str(
        pick(signing, "senderName", "sender_name") ??
          pick(docgen, "createdBy", "created_by")
      ),
      senderEmail: str(pick(signing, "senderEmail", "sender_email")),
      signingOrder,
      expiresAt: expiresIso,
      position,
      totalSigners,
      state,
    },
  };
}

/** The public state JSON for a resolved view (GET /api/sign/[token]). */
export function stateBody(
  v: SignerView,
  consentText: string
): Record<string, unknown> {
  return {
    state: v.state,
    documentName: v.documentName,
    senderName: v.senderName,
    senderEmail: v.senderEmail,
    signer: { name: v.signerName, email: v.signerEmail },
    signingOrder: v.signingOrder,
    position: v.position,
    totalSigners: v.totalSigners,
    requiresAccessCode: v.requiresAccessCode,
    consented: v.consented,
    expiresAt: v.expiresAt,
    consentText,
    downloadAvailable: v.state === "completed",
  };
}

export interface AccessCheck {
  ok: boolean;
  required: boolean;
  locked: boolean;
  attemptsLeft: number | null;
}

/** Normalize checkAccessCode's result (boolean or result object). */
export function normalizeAccessResult(raw: unknown): AccessCheck {
  if (typeof raw === "boolean") {
    return { ok: raw, required: true, locked: false, attemptsLeft: null };
  }
  const r = rec(raw);
  const attemptsLeft = numOrNull(pick(r, "attemptsLeft", "attempts_left"));
  return {
    ok: bool(pick(r, "ok", "valid", "success")),
    required: pick(r, "required") === undefined ? true : bool(r.required),
    locked:
      bool(pick(r, "locked")) ||
      (attemptsLeft !== null && attemptsLeft <= 0 && !bool(r.ok)),
    attemptsLeft,
  };
}

/**
 * Lightweight POST rate limit (per brief): count this envelope's
 * access_code_failed + sign_rejected events in the last 10 minutes
 * via the service's full-envelope read; > 20 recent failures → the
 * caller answers 429. (The service's own access lockout — 5 counted
 * attempts — is the primary control; this is a coarse backstop.) If
 * the event read is unavailable the check is skipped.
 */
export async function tooManyFailures(envelopeId: string): Promise<boolean> {
  if (!envelopeId) return false;
  try {
    const full = rec(await getEnvelopeFull(envelopeId));
    const eventsRaw = pick(full, "events");
    const events: Rec[] = Array.isArray(eventsRaw) ? (eventsRaw as Rec[]) : [];
    const cutoff = Date.now() - 10 * 60 * 1000;
    let count = 0;
    for (const e of events) {
      const kind = str(pick(e, "kind", "type", "event"));
      if (kind !== "access_code_failed" && kind !== "sign_rejected") continue;
      const at = Date.parse(str(pick(e, "createdAt", "created_at")));
      if (Number.isFinite(at) && at >= cutoff) count += 1;
    }
    return count > 20;
  } catch {
    return false;
  }
}
