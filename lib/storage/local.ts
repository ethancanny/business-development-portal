import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  assertSafeKey,
  StorageNotFoundError,
  StorageOffsetError,
  type StorageProvider,
  type StorageStatus,
} from "./types";

/**
 * Interim storage provider (Phase 3): an app-managed uploads store on
 * the server's disk, keyed by document id / upload session. Bytes stay
 * OUT of Postgres per the rules; metadata lives in core.documents +
 * dataroom.document_versions.
 *
 * HONEST LIMIT: on the current Vercel serverless deployment the only
 * writable directory is the OS temp dir, which is per-instance and
 * ephemeral — uploaded bytes do not survive instance recycling or
 * redeploys. Chunk appends self-heal across instances where possible
 * (a first chunk starts the file on whichever instance receives it; a
 * later chunk on a fresh instance reports offset 0 so the client
 * restarts the file there), but this is a stopgap, not shared storage.
 * This provider makes the whole data-room feature usable end-to-end
 * TODAY so it can be evaluated; production file bytes await Ethan's
 * SharePoint decision (the sharepoint provider swaps in behind this
 * same interface).
 *
 * Root: env DATAROOM_STORAGE_DIR, else <tmpdir>/canny-dataroom-store.
 */

function storageRoot(): string {
  const fromEnv = (process.env.DATAROOM_STORAGE_DIR ?? "").trim();
  return fromEnv || path.join(tmpdir(), "canny-dataroom-store");
}

function resolveKey(key: string): string {
  const safe = assertSafeKey(key);
  const root = storageRoot();
  const full = path.join(root, safe);
  if (!full.startsWith(root)) throw new Error(`Unsafe storage key: ${key}`);
  return full;
}

export const localProvider: StorageProvider = {
  name: "local",

  async status(): Promise<StorageStatus> {
    return {
      provider: "local",
      configured: true,
      setupRequired: false,
      detail:
        "Interim app-managed disk store active (bytes outside Postgres). " +
        "Production file storage awaits the SharePoint decision — on " +
        "serverless hosting this store is per-instance and ephemeral.",
    };
  },

  async put(key, data) {
    const full = resolveKey(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  },

  async get(key) {
    const full = resolveKey(key);
    try {
      return await fs.readFile(full);
    } catch {
      throw new StorageNotFoundError(key);
    }
  },

  async delete(key) {
    const full = resolveKey(key);
    await fs.rm(full, { force: true });
  },

  async exists(key) {
    const full = resolveKey(key);
    try {
      await fs.access(full);
      return true;
    } catch {
      return false;
    }
  },

  async beginUpload(tempKey) {
    const full = resolveKey(tempKey);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, Buffer.alloc(0));
  },

  async appendChunk(tempKey, offset, data) {
    const full = resolveKey(tempKey);
    let current = 0;
    try {
      current = (await fs.stat(full)).size;
    } catch {
      // Temp object absent on THIS instance. Serverless instances each
      // have their own temp dir, so a chunk can land on an instance that
      // never saw beginUpload. At offset 0 the upload can safely start
      // here — create the target and proceed. At any later offset the
      // earlier bytes are genuinely elsewhere: report offset 0 so the
      // client restarts the file on this instance (uploads.ts surfaces
      // this as expectedOffset via uploadSize(), which is also 0 here).
      if (offset !== 0) throw new StorageOffsetError(0);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, Buffer.alloc(0));
      current = 0;
    }
    if (current !== offset) throw new StorageOffsetError(current);
    await fs.appendFile(full, data);
    return current + data.length;
  },

  async uploadSize(tempKey) {
    const full = resolveKey(tempKey);
    try {
      return (await fs.stat(full)).size;
    } catch {
      return 0;
    }
  },

  async finalizeUpload(tempKey, finalKey) {
    const from = resolveKey(tempKey);
    const to = resolveKey(finalKey);
    await fs.mkdir(path.dirname(to), { recursive: true });
    try {
      await fs.rename(from, to);
    } catch {
      // Cross-device or missing temp: fall back to copy + delete.
      const data = await fs.readFile(from).catch(() => {
        throw new StorageNotFoundError(tempKey);
      });
      await fs.writeFile(to, data);
      await fs.rm(from, { force: true });
    }
  },

  async abortUpload(tempKey) {
    await fs.rm(resolveKey(tempKey), { force: true });
  },
};
