import { createHash } from "crypto";
import forge from "node-forge";
import { extractSignature } from "@signpdf/utils";
import { getDocument, readDocumentBytes } from "../dataroom/documents";
import { getEnvelopeFull } from "./service";

/**
 * Executed-PDF verification (in-house e-signature build, Workstream B).
 *
 * Three byte-level checks over the executed document (or a candidate
 * copy supplied by the caller — e.g. a file a counterparty sends
 * back), plus the signing.events hash-chain recomputation:
 *
 *  1. hash_intact — SHA-256 of the bytes equals the executed_sha256
 *     recorded at completion.
 *  2. signature_present — @signpdf extracts a PKCS#7 signature +
 *     ByteRange without throwing.
 *  3. byte_range_digest — the SHA-256 over the ByteRange-covered
 *     bytes equals the messageDigest authenticated attribute inside
 *     the PKCS#7 SignedData (parsed with node-forge). This is the
 *     cryptographic statement that the sealed bytes are the bytes
 *     that were signed. If the forge walk cannot locate the
 *     attribute, the check falls back to ByteRange coverage
 *     (ranges span the whole file except the signature hole) and
 *     SAYS SO in its detail — no fake crypto claims.
 *
 * Chain rule (confirmed verbatim against lib/signing/service.ts
 * appendEvent/verifyEventChain): entry_hash = sha256(prev_hash + '|'
 * + envelope_id + '|' + kind + '|' + actor + '|' + created_at_iso +
 * '|' + JSON.stringify(detail)); genesis prev_hash =
 * sha256(envelope_id); events ordered (created_at, id); created_at
 * and detail are the stored row's ISO string / parsed JSONB object,
 * exactly as service.ts rowToSigningEvent returns them.
 */

export interface VerifyCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  checks: VerifyCheck[];
  auditChainValid: boolean;
}

function sha256HexLocal(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/* ------------------------- PKCS#7 digest ------------------------- */

interface Asn1Node {
  tagClass: number;
  type: number;
  constructed: boolean;
  value: unknown;
}

function asn1Children(node: Asn1Node): Asn1Node[] {
  return Array.isArray(node.value) ? (node.value as Asn1Node[]) : [];
}

/** DER content bytes of an OID node, as hex (universal tag 6). */
function oidHex(node: Asn1Node): string | null {
  if (node.type !== 6 || typeof node.value !== "string") return null;
  return Buffer.from(node.value as string, "binary").toString("hex");
}

// messageDigest OID 1.2.840.113549.1.9.4, DER content bytes.
const MESSAGE_DIGEST_OID_HEX = "2a864886f70d010904";

/** Find the messageDigest authenticated attribute in a CMS SignedData. */
function findMessageDigest(node: Asn1Node, depth: number): string | null {
  if (depth > 14) return null;
  const kids = asn1Children(node);
  // Attribute ::= SEQUENCE { oid messageDigest, SET { OCTET STRING } }
  if (node.type === 16 && kids.length >= 2) {
    if (oidHex(kids[0]) === MESSAGE_DIGEST_OID_HEX) {
      const values = asn1Children(kids[1]);
      const octets = values.find(
        (v) => v.type === 4 && typeof v.value === "string"
      );
      if (octets) {
        return Buffer.from(octets.value as string, "binary").toString("hex");
      }
    }
  }
  for (const kid of kids) {
    const found = findMessageDigest(kid, depth + 1);
    if (found) return found;
  }
  return null;
}

/* ------------------------------ main ------------------------------ */

export async function verifyExecutedPdf(
  envelopeId: string,
  candidateBytes?: Buffer
): Promise<VerifyResult> {
  const full = await getEnvelopeFull(envelopeId);
  if (!full) throw new Error("envelope_not_found");
  const signing = full.signing;

  // Audit chain (formula confirmed against service.ts — see header).
  let auditChainValid = true;
  {
    let prev = sha256HexLocal(envelopeId);
    for (const ev of full.events) {
      const expected = sha256HexLocal(
        [
          prev,
          envelopeId,
          ev.kind,
          ev.actor,
          ev.createdAt,
          JSON.stringify(ev.detail),
        ].join("|")
      );
      if (ev.prevHash !== prev || ev.entryHash !== expected) {
        auditChainValid = false;
        break;
      }
      prev = ev.entryHash;
    }
  }

  const checks: VerifyCheck[] = [];

  let bytes: Buffer | null = candidateBytes ?? null;
  if (!bytes) {
    if (signing.executedDocumentId) {
      try {
        const doc = await getDocument(signing.executedDocumentId);
        if (doc) bytes = (await readDocumentBytes(doc)).bytes;
      } catch {
        bytes = null;
      }
    }
  }
  if (!bytes) {
    checks.push({
      key: "hash_intact",
      label: "Executed hash intact",
      ok: false,
      detail: signing.executedDocumentId
        ? "Executed document bytes could not be read from storage."
        : "Envelope has no executed document yet.",
    });
    checks.push({
      key: "signature_present",
      label: "Cryptographic signature present",
      ok: false,
      detail: "No bytes available to inspect.",
    });
    checks.push({
      key: "byte_range_digest",
      label: "Byte-range digest matches signed attributes",
      ok: false,
      detail: "No bytes available to inspect.",
    });
    return { ok: false, checks, auditChainValid };
  }

  // (1) Recorded hash.
  const actualHash = sha256HexLocal(bytes);
  checks.push({
    key: "hash_intact",
    label: "Executed hash intact",
    ok: Boolean(signing.executedSha256) && actualHash === signing.executedSha256,
    detail: signing.executedSha256
      ? `SHA-256 ${actualHash.slice(0, 16)}… vs recorded ${signing.executedSha256.slice(0, 16)}…`
      : "No executed_sha256 recorded for this envelope.",
  });

  // (2) Signature extraction. @signpdf/utils returns
  // { ByteRange: number[], signature: <binary string>, signedData }.
  let signature: Buffer | null = null;
  let byteRange: number[] = [];
  try {
    const extracted = extractSignature(bytes) as unknown as {
      ByteRange?: number[];
      signature?: string | Buffer;
    };
    if (extracted && extracted.signature && extracted.ByteRange) {
      signature = Buffer.isBuffer(extracted.signature)
        ? extracted.signature
        : Buffer.from(extracted.signature, "binary");
      byteRange = extracted.ByteRange.map((n) => Number(n));
    }
  } catch {
    signature = null;
  }
  checks.push({
    key: "signature_present",
    label: "Cryptographic signature present",
    ok: Boolean(signature && byteRange.length === 4),
    detail: signature
      ? `PKCS#7 signature extracted (${signature.length} bytes), ByteRange [${byteRange.join(", ")}].`
      : "No embedded signature could be extracted from these bytes.",
  });

  // (3) Byte-range digest vs the PKCS#7 messageDigest attribute.
  if (signature && byteRange.length === 4) {
    const [a, b, c, d] = byteRange;
    const covered = Buffer.concat([
      bytes.subarray(a, a + b),
      bytes.subarray(c, c + d),
    ]);
    const coveredHash = sha256HexLocal(covered);
    let attributeDigest: string | null = null;
    try {
      const asn1 = forge.asn1.fromDer(
        forge.util.createBuffer(signature.toString("binary"))
      ) as unknown as Asn1Node;
      attributeDigest = findMessageDigest(asn1, 0);
    } catch {
      attributeDigest = null;
    }
    if (attributeDigest) {
      checks.push({
        key: "byte_range_digest",
        label: "Byte-range digest matches signed attributes",
        ok: coveredHash === attributeDigest,
        detail:
          coveredHash === attributeDigest
            ? "SHA-256 over the ByteRange-covered bytes equals the messageDigest attribute inside the PKCS#7 signature — the sealed bytes are the signed bytes."
            : `Digest mismatch: computed ${coveredHash.slice(0, 16)}… vs attribute ${attributeDigest.slice(0, 16)}… — the document was altered after sealing.`,
      });
    } else {
      const coversWholeFile = a === 0 && c + d === bytes.length;
      checks.push({
        key: "byte_range_digest",
        label: "Byte-range digest matches signed attributes",
        ok: coversWholeFile,
        detail:
          "The PKCS#7 messageDigest attribute could not be located by the ASN.1 walk, so this check verifies ByteRange COVERAGE only (the ranges span the entire file except the signature hole, and the signature extracted cleanly) — it does not compare the signed digest.",
      });
    }
  } else {
    checks.push({
      key: "byte_range_digest",
      label: "Byte-range digest matches signed attributes",
      ok: false,
      detail: "Skipped — no signature was extracted.",
    });
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
    auditChainValid,
  };
}
