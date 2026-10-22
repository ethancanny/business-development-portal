/**
 * Storage provider abstraction (Phase 3 — Data Rooms / Documents).
 *
 * File BYTES never live in Postgres (PROJECT_RULES.md). They live behind
 * this interface: today the interim `local` provider (app-managed disk
 * store) is active; the `sharepoint` provider swaps in behind the same
 * interface once Ethan consents to the Graph Files/Sites scopes (see
 * lib/storage/sharepoint.ts — a REAL DECISION, never self-service).
 *
 * Keys are provider-relative paths, e.g.
 *   documents/<documentId>/v<version>/<filename>
 *   uploads/<sessionId>.part        (in-flight chunked upload)
 */

export interface StorageStatus {
  /** Provider key: "local" | "sharepoint". */
  provider: string;
  /** True when the provider can serve reads/writes right now. */
  configured: boolean;
  /** True when Ethan must complete a setup step before it can work. */
  setupRequired: boolean;
  detail: string;
  /** Graph scopes still missing, when setupRequired is about scopes. */
  missingScopes?: string[];
}

/** Thrown by a provider that cannot operate until setup is completed. */
export class StorageSetupRequiredError extends Error {
  missingScopes: string[];
  constructor(message: string, missingScopes: string[] = []) {
    super(message);
    this.name = "StorageSetupRequiredError";
    this.missingScopes = missingScopes;
  }
}

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`Storage object not found: ${key}`);
    this.name = "StorageNotFoundError";
  }
}

/** Thrown when a chunk arrives at an unexpected offset (resumable uploads). */
export class StorageOffsetError extends Error {
  expected: number;
  constructor(expected: number) {
    super(`Chunk offset mismatch: expected ${expected}`);
    this.name = "StorageOffsetError";
    this.expected = expected;
  }
}

export interface StorageProvider {
  readonly name: string;
  status(): Promise<StorageStatus>;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Start (or reset) a resumable upload target. */
  beginUpload(tempKey: string): Promise<void>;
  /** Append one chunk at an exact byte offset; returns new total size. */
  appendChunk(tempKey: string, offset: number, data: Buffer): Promise<number>;
  /** Current size of an in-flight upload target (0 when absent). */
  uploadSize(tempKey: string): Promise<number>;
  /** Move an in-flight upload to its final key. */
  finalizeUpload(tempKey: string, finalKey: string): Promise<void>;
  /** Discard an in-flight upload. */
  abortUpload(tempKey: string): Promise<void>;
}

/**
 * Keys must be safe relative paths: no traversal, no absolute paths, no
 * backslashes. Enforced by every provider before touching storage.
 */
export function assertSafeKey(key: string): string {
  const k = (key ?? "").trim();
  if (
    !k ||
    k.startsWith("/") ||
    k.startsWith("\\") ||
    k.includes("\\") ||
    k.split("/").some((seg) => seg === ".." || seg === ".") ||
    !/^[A-Za-z0-9._/-]+$/.test(k)
  ) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
  return k;
}

/** Sanitize a user-supplied filename for use as the last key segment. */
export function safeFilename(name: string): string {
  const base = (name ?? "file")
    .split(/[\\/]/)
    .pop()!
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 160);
  return base || "file";
}
