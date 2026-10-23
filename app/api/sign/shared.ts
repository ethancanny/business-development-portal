import { NextRequest, NextResponse } from "next/server";
import {
  getEnvelopeFull,
  resolveSignerToken,
} from "@/lib/signing/service";

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
  | { ok: false; error: "not_found" | "expired" | "voided" | "declined" };

function errorCodeOf(err: unknown): string {
  if (err instanceof Error && /^[a-z][a-z0-9_]+$/.test(err.message)) {
    return err.message;
  }
  const r = rec(err);
  if (typeof r.error === "string") return r.error;
  if (typeof r.code === "string") return r.code;
  if (typeof r.reason === "string") return r.reason;
  return "";
}

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
 * normalize whatever row shape it returns into the public view.
 * Handles both result-object ({ ok, ... } / { error }) and
 * throw-coded-error service styles.
 */
export async function resolveSigner(
  token: string
): Promise<ResolveOutcome> {
  let raw: unknown;
  try {
    raw = await resolveSignerToken(token);
  } catch (err) {
    const code = errorCodeOf(err);
    if (code === "expired") return { ok: false, error: "expired" };
    if (code === "voided") return { ok: false, error: "voided" };
    if (code === "declined") return { ok: false, error: "declined" };
    if (code === "not_found") return { ok: false, error: "not_found" };
    throw err;
  }
  if (!raw) return { ok: false, error: "not_found" };
  const root = rec(raw);
  if (root.ok === false) {
    const code =
      str(pick(root, "error", "code", "reason")) || "not_found";
    if (code === "expired") return { ok: false, error: "expired" };
    if (code === "voided") return { ok: false, error: "voided" };
    if (code === "declined") return { ok: false, error: "declined" };
    return { ok: false, error: "not_found" };
  }

  const signer = rec(pick(root, "signer", "signerRow"));
  const envelope = rec(pick(root, "envelope"));
  const signing = rec(pick(root, "signing"));
  const signersRaw = pick(root, "signers") ?? pick(envelope, "signers");
  const signers: Rec[] = Array.isArray(signersRaw)
    ? (signersRaw as Rec[])
    : Array.isArray(signing.signers)
      ? (signing.signers as Rec[])
      : [];

  const signerId = str(pick(signer, "id", "signerId"));
  const envelopeId = str(
    pick(envelope, "id", "envelopeId") ?? pick(signer, "envelopeId")
  );
  const envelopeStatus = str(
    pick(envelope, "status") ?? pick(signing, "status")
  ).toLowerCase();
  const signerStatus = str(pick(signer, "status")).toLowerCase();
  const expiresAt =
    (pick(envelope, "expiresAt", "expires_at") as string | null) ??
    (pick(signing, "expiresAt", "expires_at") as string | null) ??
    null;
  const expiresIso =
    typeof expiresAt === "string" && expiresAt ? expiresAt : null;

  const signingOrderRaw = str(
    pick(envelope, "signingOrder", "signing_order") ??
      pick(signing, "signingOrder", "signing_order")
  ).toLowerCase();
  const signingOrder: "sequential" | "parallel" =
    signingOrderRaw === "sequential" ? "sequential" : "parallel";

  // Position: this signer's index within the ordered signer list
  // (the service's orderIndex is 0-based; the public position is not).
  let position =
    numOrNull(pick(signer, "position", "order", "signingOrder")) ?? 0;
  if (position <= 0) {
    const oi = numOrNull(pick(signer, "orderIndex", "order_index"));
    if (oi !== null && oi >= 0) position = oi + 1;
  }
  if (signers.length > 0) {
    const idx = signers.findIndex(
      (s) => str(pick(s, "id", "signerId")) === signerId && signerId !== ""
    );
    if (idx >= 0) position = idx + 1;
    else if (position <= 0) position = 1;
  } else if (position <= 0) {
    position = 1;
  }
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
      | null) ??
    (pick(envelope, "preparedDocumentId", "prepared_document_id") as
      | string
      | null) ??
    null;
  const executedDocumentId =
    (pick(signing, "executedDocumentId", "executed_document_id") as
      | string
      | null) ??
    (pick(envelope, "executedDocumentId", "executed_document_id") as
      | string
      | null) ??
    null;
  const documentId =
    (pick(envelope, "documentId", "document_id") as string | null) ??
    (pick(signing, "documentId", "document_id") as string | null) ??
    null;

  // ---- state derivation ----
  let state: SignerView["state"];
  if (envelopeStatus === "voided" || envelopeStatus === "void") {
    state = "voided";
  } else if (
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
    // No signer list in the resolve payload: the service marks a
    // not-yet-active sequential signer "pending".
    state = "waiting";
  } else {
    state = "active";
  }
  // An expired envelope reports the expired outcome at resolve level
  // (410 with state) unless the envelope reached a terminal signed
  // state. Voided / declined stay ok:true with their state set — the
  // GET state route renders them as informational pages (200), while
  // the document + POST routes refuse them.
  if (state === "expired") return { ok: false, error: "expired" };

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
      attemptsLeft: numOrNull(
        pick(signer, "attemptsLeft", "attempts_left")
      ),
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
      documentName:
        str(
          pick(root, "documentName", "document_name") ??
            pick(signing, "documentName", "document_name") ??
            pick(envelope, "documentName", "document_name")
        ) || "Document",
      senderName: str(
        pick(signing, "senderName", "sender_name") ??
          pick(envelope, "senderName", "sender_name", "createdBy", "created_by") ??
          pick(root, "senderName", "sender_name")
      ),
      senderEmail: str(
        pick(signing, "senderEmail", "sender_email") ??
          pick(envelope, "senderEmail", "sender_email") ??
          pick(root, "senderEmail", "sender_email")
      ),
      signingOrder,
      expiresAt: expiresIso,
      position,
      totalSigners,
      state,
    },
  };
}

/** Map a failed resolve outcome to its HTTP response. */
export function resolveFailure(outcome: { error: string }): NextResponse {
  switch (outcome.error) {
    case "expired":
      return jsonNoStore({ error: "expired", state: "expired" }, { status: 410 });
    case "voided":
      return jsonNoStore({ error: "voided", state: "voided" }, { status: 200 });
    case "declined":
      return jsonNoStore(
        { error: "declined", state: "declined" },
        { status: 200 }
      );
    default:
      return jsonNoStore({ error: "not_found" }, { status: 404 });
  }
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
 * caller answers 429. If the event read is unavailable the check is
 * skipped (the access-code lockout in the service still applies).
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
