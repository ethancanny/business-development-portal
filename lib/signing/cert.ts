import { createHash, randomBytes } from "crypto";
import forge from "node-forge";
import { ensurePlatformSchema, sql, str, isoOrNull } from "../platform/db";

/**
 * Platform signing certificate (in-house e-signature build).
 *
 * The portal seals executed documents with ONE self-signed platform
 * certificate for "Canny Capital Partners". The PKCS#12 bundle and its
 * passphrase live ONLY in the signing.key_store table (server-side DB
 * config — never in code, env files, logs, or chat; PROJECT_RULES.md).
 * This module is the only reader/writer of that table and never logs
 * key material: the only values that leave it are the public
 * certificate metadata (subject / fingerprint / validity window) and,
 * via getSigningKeyMaterial(), the bundle a server-side seal operation
 * needs in-process.
 *
 * Table (owned by this module, created idempotently here):
 *   signing.key_store (id INT PK CHECK id = 1, p12_base64, passphrase,
 *   cert_subject, cert_fingerprint, cert_not_before, cert_not_after,
 *   created_at) — a singleton row (id = 1).
 */

export interface CertificateInfo {
  subject: string;
  /** SHA-256 hex of the certificate DER bytes. */
  fingerprint: string;
  notBefore: string;
  notAfter: string;
}

const CERT_SUBJECT = "Canny Capital Partners";

let keySchemaReady: Promise<void> | null = null;

function ensureKeySchema(): Promise<void> {
  if (!keySchemaReady) {
    keySchemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS signing`;
      await db`
        CREATE TABLE IF NOT EXISTS signing.key_store (
          id INT PRIMARY KEY CHECK (id = 1),
          p12_base64 TEXT NOT NULL DEFAULT '',
          passphrase TEXT NOT NULL DEFAULT '',
          cert_subject TEXT NOT NULL DEFAULT '',
          cert_fingerprint TEXT NOT NULL DEFAULT '',
          cert_not_before TIMESTAMPTZ,
          cert_not_after TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
    })().catch((err) => {
      keySchemaReady = null;
      throw err;
    });
  }
  return keySchemaReady;
}

interface KeyStoreRow {
  p12Base64: string;
  passphrase: string;
  subject: string;
  fingerprint: string;
  notBefore: string;
  notAfter: string;
}

async function readKeyRow(): Promise<KeyStoreRow | null> {
  await ensureKeySchema();
  const db = sql();
  const rows = await db`
    SELECT p12_base64, passphrase, cert_subject, cert_fingerprint,
      cert_not_before, cert_not_after
    FROM signing.key_store WHERE id = 1 LIMIT 1`;
  if (!rows.length) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    p12Base64: str(r.p12_base64),
    passphrase: str(r.passphrase),
    subject: str(r.cert_subject),
    fingerprint: str(r.cert_fingerprint),
    notBefore: isoOrNull(r.cert_not_before) ?? "",
    notAfter: isoOrNull(r.cert_not_after) ?? "",
  };
}

function toInfo(row: KeyStoreRow): CertificateInfo {
  return {
    subject: row.subject,
    fingerprint: row.fingerprint,
    notBefore: row.notBefore,
    notAfter: row.notAfter,
  };
}

/** Generate a fresh self-signed platform certificate + PKCS#12 bundle. */
function generateKeyMaterial(): KeyStoreRow & { p12Buffer: Buffer } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  // Random 128-bit serial, forced positive (DER INTEGER sign bit).
  let serial = randomBytes(16).toString("hex");
  if (parseInt(serial.slice(0, 2), 16) >= 0x80) serial = `00${serial}`;
  cert.serialNumber = serial;
  const now = new Date();
  const notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const notAfter = new Date(now.getTime());
  notAfter.setFullYear(notAfter.getFullYear() + 3);
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  const attrs: forge.pki.CertificateField[] = [
    { name: "commonName", value: CERT_SUBJECT },
    { name: "organizationName", value: CERT_SUBJECT },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    {
      name: "keyUsage",
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: false,
      dataEncipherment: false,
      keyCertSign: false,
      cRLSign: false,
    },
    {
      name: "extKeyUsage",
      emailProtection: true,
      codeSigning: true,
    },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const derBytes = forge.asn1
    .toDer(forge.pki.certificateToAsn1(cert))
    .getBytes();
  const derBuffer = Buffer.from(derBytes, "binary");
  const fingerprint = createHash("sha256").update(derBuffer).digest("hex");

  const passphrase = randomBytes(24).toString("hex");
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: "3des",
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const p12Buffer = Buffer.from(p12Der, "binary");

  const subject = cert.subject.attributes
    .map((a) => `${a.shortName ?? a.name ?? ""}=${String(a.value ?? "")}`)
    .filter((s) => !s.startsWith("="))
    .join(", ");

  return {
    p12Buffer,
    p12Base64: p12Buffer.toString("base64"),
    passphrase,
    subject: subject || `CN=${CERT_SUBJECT}, O=${CERT_SUBJECT}`,
    fingerprint,
    notBefore: notBefore.toISOString(),
    notAfter: notAfter.toISOString(),
  };
}

/**
 * Return the platform certificate's public metadata, generating and
 * persisting the singleton key on first use. Safe under concurrency:
 * the insert is ON CONFLICT DO NOTHING and the row is re-read, so a
 * racing caller ends up with the same stored certificate.
 */
export async function ensureSigningKey(): Promise<CertificateInfo> {
  const existing = await readKeyRow();
  if (existing && existing.p12Base64) return toInfo(existing);

  const generated = generateKeyMaterial();
  const db = sql();
  await db`
    INSERT INTO signing.key_store
      (id, p12_base64, passphrase, cert_subject, cert_fingerprint,
        cert_not_before, cert_not_after)
    VALUES (1, ${generated.p12Base64}, ${generated.passphrase},
      ${generated.subject}, ${generated.fingerprint},
      ${generated.notBefore}, ${generated.notAfter})
    ON CONFLICT (id) DO NOTHING`;
  const stored = await readKeyRow();
  if (!stored) throw new Error("signing_key_store_unavailable");
  return toInfo(stored);
}

/**
 * Public certificate metadata. Ensures the platform key exists first
 * (ensureSigningKey is idempotent — it generates and persists the
 * self-signed certificate only when the key_store row is absent), so
 * status surfaces show the fingerprint even before any envelope has
 * been finalized. Returns null only if the row is still unreadable
 * after ensuring.
 */
export async function getCertificateInfo(): Promise<CertificateInfo | null> {
  await ensureSigningKey();
  const row = await readKeyRow();
  if (!row || !row.p12Base64) return null;
  return toInfo(row);
}

/**
 * Server-only: the PKCS#12 bundle + passphrase a seal operation needs.
 * Generates the key first if none exists. Never log the return value.
 */
export async function getSigningKeyMaterial(): Promise<{
  p12Buffer: Buffer;
  passphrase: string;
}> {
  let row = await readKeyRow();
  if (!row || !row.p12Base64) {
    await ensureSigningKey();
    row = await readKeyRow();
  }
  if (!row || !row.p12Base64) throw new Error("signing_key_unavailable");
  return {
    p12Buffer: Buffer.from(row.p12Base64, "base64"),
    passphrase: row.passphrase,
  };
}
