import { graph, msConnected } from "../microsoft";
import {
  assertSafeKey,
  StorageNotFoundError,
  StorageOffsetError,
  StorageSetupRequiredError,
  type StorageProvider,
  type StorageStatus,
} from "./types";

/**
 * SharePoint / Microsoft Graph storage provider (Phase 3) — the real
 * driver, built Oct 23, 2026 after Ethan granted the delegated
 * Files.ReadWrite.All + Sites.ReadWrite.All scopes in Entra (admin
 * consent) and the portal's SCOPES constant was extended to request
 * them. Callers use the key-only contract in ./types; nothing about
 * them changed.
 *
 * Layout: ONE SharePoint site (default display name "Canny Capital —
 * Deals", overridable via SHAREPOINT_SITE_ID / SHAREPOINT_SITE_NAME)
 * and ONE app-provisioned document library on it (default "Portal
 * Documents", SHAREPOINT_LIBRARY_NAME). Storage keys map to the
 * folder tree inside that library:
 *   documents/<documentId>/v<version>/<filename>
 *   uploads/<sessionId>.part        (in-flight chunked upload)
 * Data rooms are stamped provider="sharepoint" + provider_ref=<drive
 * id> by the provisioning pass (lib/storage/provision.ts). Per-room
 * libraries are NOT implemented: the provider contract is key-only —
 * dataroom, comms, docgen, financials, and portfolio callers all pass
 * keys, never rooms — so one library with the key tree is the honest
 * shape; room separation lives in the tree, not in drive boundaries.
 *
 * Chunked uploads: Graph upload sessions demand the total size and
 * fixed 320 KiB-multiple chunks up front, but the provider contract
 * appends at offsets without a declared total. So an in-flight upload
 * is a FOLDER at the temp key holding one item per chunk
 * (<zero-padded offset>.chunk). State lives in SharePoint itself, so
 * sessions survive serverless instance churn (the interim local
 * provider's known weakness). get() on a temp key assembles the
 * chunks in order; finalizeUpload assembles, writes the final key,
 * and deletes the folder. Plain-file temps (docgen / portfolio put a
 * finished file at a temp key, then finalize) move via item PATCH.
 *
 * put(): single PUT for <= 4 MiB; a Graph upload session with the
 * known total above that. get(): item metadata's pre-signed
 * downloadUrl, fetched without an auth header.
 */

export const SHAREPOINT_MISSING_SCOPES = [
  "Files.ReadWrite.All",
  "Sites.ReadWrite.All",
] as const;

export const SHAREPOINT_SETUP_STEPS: string[] = [
  "Entra setup (done Oct 23, 2026): delegated Files.ReadWrite.All and Sites.ReadWrite.All added to the existing portal app registration and admin-consented; the portal requests them in lib/microsoft.ts SCOPES.",
  "Reconnect Microsoft in the portal (Settings → Integrations) AFTER the scope change deploys, so the stored token carries the new permissions — a token minted before consent cannot call Files/Sites endpoints.",
  "Confirm the SharePoint site exists with the display name \"Canny Capital — Deals\" (or set SHAREPOINT_SITE_ID / SHAREPOINT_SITE_NAME in the portal's environment to point elsewhere).",
  "Deploy the driver first, THEN set STORAGE_PROVIDER=sharepoint in the environment and redeploy. Flipping the env var before the driver exists (or before reconnect) makes document operations fail — the interim local provider serves bytes until the flip.",
  "Run \"Provision SharePoint library\" in Settings → Integrations: it creates the \"Portal Documents\" library on the site and stamps every data room to the SharePoint provider.",
  "Verify with the version-restore test: upload a document, upload a second version, restore the first — the restored bytes must match the original (the path the interim local store could fail when an instance lacked the old bytes).",
];

const DEFAULT_SITE_NAME = "Canny Capital — Deals";
const DEFAULT_LIBRARY_NAME = "Portal Documents";
/** Graph simple-upload ceiling; larger payloads use an upload session. */
const SIMPLE_PUT_MAX = 4 * 1024 * 1024;
/** Upload-session slice: 5 MiB — a multiple of Graph's 320 KiB quantum. */
const SESSION_SLICE = 5 * 1024 * 1024;

interface DriveItem {
  id: string;
  name?: string;
  size?: number;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  "@microsoft.graph.downloadUrl"?: string;
}

interface ResolvedSite {
  id: string;
  displayName: string;
}

interface ResolvedDrive {
  site: ResolvedSite;
  driveId: string;
  driveName: string;
}

/* ------------------------- error translation ------------------------- */

function graphStatusCode(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /failed \((\d{3})\)/.exec(msg);
  return m ? Number(m[1]) : null;
}

function isScopeStyleError(err: unknown): boolean {
  const code = graphStatusCode(err);
  return code === 401 || code === 403;
}

function setupError(detail: string): StorageSetupRequiredError {
  return new StorageSetupRequiredError(detail, [...SHAREPOINT_MISSING_SCOPES]);
}

/** graph() as a probe: parsed JSON on success, null on 404. Scope-style
 *  failures become StorageSetupRequiredError (the stored token predates
 *  consent, or consent never landed) so callers surface setup_required
 *  instead of a raw Graph error. */
async function g<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit
): Promise<T | null> {
  try {
    return (await graph(path, undefined, init)) as T | null;
  } catch (err) {
    if (graphStatusCode(err) === 404) return null;
    if (isScopeStyleError(err)) {
      // Surface Graph's own words (Oct 24, 2026): the generic "predates
      // consent" text sent Ethan through two reconnects without ever
      // naming the actual refusal. The graph() error message carries
      // the status + the Graph error body — quote it.
      const raw = err instanceof Error ? err.message : String(err);
      const excerpt = raw.replace(/\s+/g, " ").slice(0, 260);
      throw setupError(
        "SharePoint storage is not reachable with the current Microsoft " +
          "token (Graph refused a Files/Sites call). Reconnect Microsoft " +
          "from the Calendar page so a fresh token carries " +
          "Files.ReadWrite.All and Sites.ReadWrite.All. " +
          `Graph said: ${excerpt}`
      );
    }
    throw err;
  }
}

/* --------------------------- site / drive ---------------------------- */

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

let siteCache: { at: number; site: ResolvedSite } | null = null;
const RESOLUTION_TTL_MS = 5 * 60 * 1000;

export async function resolveSharePointSite(): Promise<ResolvedSite> {
  const envId = (process.env.SHAREPOINT_SITE_ID ?? "").trim();
  if (envId) return { id: envId, displayName: "(SHAREPOINT_SITE_ID)" };
  if (siteCache && Date.now() - siteCache.at < RESOLUTION_TTL_MS) {
    return siteCache.site;
  }
  const name = (process.env.SHAREPOINT_SITE_NAME ?? "").trim() || DEFAULT_SITE_NAME;
  const res = await g<{ value?: { id: string; displayName?: string }[] }>(
    `/sites?search=${encodeURIComponent(name)}`
  );
  const found = (res?.value ?? []).filter((s) => s && s.id);
  const exact = found.find(
    (s) => normalizeName(s.displayName ?? "") === normalizeName(name)
  );
  const pick = exact ?? (found.length === 1 ? found[0] : null);
  if (!pick) {
    const names = found.map((s) => s.displayName || s.id).join(", ");
    throw setupError(
      `SharePoint site "${name}" could not be resolved (search found ` +
        `${found.length} site(s)${names ? `: ${names}` : ""}). Create the ` +
        `site with that exact name, or set SHAREPOINT_SITE_ID / ` +
        `SHAREPOINT_SITE_NAME in the portal's environment.`
    );
  }
  const site = { id: pick.id, displayName: pick.displayName ?? name };
  siteCache = { at: Date.now(), site };
  return site;
}

async function listDrives(
  siteId: string
): Promise<{ id: string; name?: string }[]> {
  const res = await g<{ value?: { id: string; name?: string }[] }>(
    `/sites/${siteId}/drives?$select=id,name`
  );
  return (res?.value ?? []).filter((d) => d && d.id);
}

export async function ensureSharePointDrive(
  create: boolean
): Promise<ResolvedDrive | null> {
  const site = await resolveSharePointSite();
  const libName =
    (process.env.SHAREPOINT_LIBRARY_NAME ?? "").trim() || DEFAULT_LIBRARY_NAME;
  const drives = await listDrives(site.id);
  const hit = drives.find(
    (d) => normalizeName(d.name ?? "") === normalizeName(libName)
  );
  if (hit) return { site, driveId: hit.id, driveName: hit.name ?? libName };
  if (!create) return null;
  // Creating a document library = creating a list with the
  // documentLibrary template; its drive appears alongside.
  await g(`/sites/${site.id}/lists`, {
    method: "POST",
    body: JSON.stringify({
      displayName: libName,
      list: { template: "documentLibrary" },
    }),
  });
  for (let i = 0; i < 6; i++) {
    const after = await listDrives(site.id);
    const made = after.find(
      (d) => normalizeName(d.name ?? "") === normalizeName(libName)
    );
    if (made) return { site, driveId: made.id, driveName: made.name ?? libName };
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    `Document library "${libName}" was created on site "${site.displayName}" but its drive did not appear; retry provisioning in a minute.`
  );
}

async function requireDrive(): Promise<ResolvedDrive> {
  const drive = await ensureSharePointDrive(false);
  if (!drive) {
    throw setupError(
      `SharePoint library "${DEFAULT_LIBRARY_NAME}" is not provisioned ` +
        `yet — run "Provision SharePoint library" in Settings → ` +
        `Integrations after reconnecting Microsoft.`
    );
  }
  return drive;
}

/* ------------------------------ paths -------------------------------- */

function encPath(key: string): string {
  return assertSafeKey(key).split("/").map(encodeURIComponent).join("/");
}

function parentPath(key: string): string {
  const idx = key.lastIndexOf("/");
  return idx === -1 ? "" : key.slice(0, idx);
}

function baseName(key: string): string {
  const idx = key.lastIndexOf("/");
  return idx === -1 ? key : key.slice(idx + 1);
}

async function itemByPath(
  driveId: string,
  key: string
): Promise<DriveItem | null> {
  return g<DriveItem>(`/drives/${driveId}/root:/${encPath(key)}`);
}

async function rootItem(driveId: string): Promise<DriveItem | null> {
  return g<DriveItem>(`/drives/${driveId}/root`);
}

/** Ensure every folder segment of dirPath exists; returns the deepest
 *  folder item (or the drive root item when dirPath is ""). */
async function ensureFolder(
  driveId: string,
  dirPath: string
): Promise<DriveItem> {
  let current = await rootItem(driveId);
  if (!current) throw new Error("SharePoint drive root is unavailable");
  if (!dirPath) return current;
  let walked = "";
  for (const seg of dirPath.split("/")) {
    walked = walked ? `${walked}/${seg}` : seg;
    const existing = await itemByPath(driveId, walked);
    if (existing?.folder) {
      current = existing;
      continue;
    }
    if (existing) {
      throw new Error(`Storage path segment is a file, not a folder: ${walked}`);
    }
    const parentRef = parentPath(walked);
    const createPath = parentRef
      ? `/drives/${driveId}/root:/${encPath(parentRef)}:/children`
      : `/drives/${driveId}/root/children`;
    const made = await g<DriveItem>(createPath, {
      method: "POST",
      body: JSON.stringify({
        name: seg,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });
    if (made) {
      current = made;
    } else {
      // Lost a create race or Graph answered 404 oddly — re-read.
      const again = await itemByPath(driveId, walked);
      if (!again?.folder) throw new Error(`Could not create folder: ${walked}`);
      current = again;
    }
  }
  return current;
}

/* --------------------------- byte transfer --------------------------- */

async function putBytes(driveId: string, key: string, data: Buffer): Promise<void> {
  const dir = parentPath(key);
  if (dir) await ensureFolder(driveId, dir);
  if (data.length <= SIMPLE_PUT_MAX) {
    await g(`/drives/${driveId}/root:/${encPath(key)}:/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(data),
    });
    return;
  }
  const session = await g<{ uploadUrl?: string }>(
    `/drives/${driveId}/root:/${encPath(key)}:/createUploadSession`,
    {
      method: "POST",
      body: JSON.stringify({
        item: {
          "@microsoft.graph.conflictBehavior": "replace",
          name: baseName(key),
        },
      }),
    }
  );
  const uploadUrl = session?.uploadUrl;
  if (!uploadUrl) throw new Error("Graph did not return an upload session URL");
  const total = data.length;
  for (let start = 0; start < total; start += SESSION_SLICE) {
    const end = Math.min(total, start + SESSION_SLICE);
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - start),
        "Content-Range": `bytes ${start}-${end - 1}/${total}`,
      },
      body: new Uint8Array(data.subarray(start, end)),
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `SharePoint upload failed at byte ${start} (${res.status}): ${text.slice(0, 200)}`
      );
    }
  }
}

async function downloadItem(item: DriveItem): Promise<Buffer> {
  const url = item["@microsoft.graph.downloadUrl"];
  if (!url) throw new Error(`Drive item ${item.id} has no download URL`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SharePoint download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** Children of a chunk folder (single page — a 200 MiB file in 2 MiB
 *  chunks is 100 items, under the 200 page size). */
async function chunkChildren(
  driveId: string,
  tempKey: string
): Promise<DriveItem[]> {
  const res = await g<{ value?: DriveItem[] }>(
    `/drives/${driveId}/root:/${encPath(tempKey)}:/children?$select=name,size,file&$top=200`
  );
  return (res?.value ?? []).filter((c) => c.file);
}

function chunkName(offset: number): string {
  return `${String(offset).padStart(12, "0")}.chunk`;
}

async function assembleChunks(driveId: string, tempKey: string): Promise<Buffer> {
  const chunks = (await chunkChildren(driveId, tempKey)).sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "")
  );
  const parts: Buffer[] = [];
  for (const c of chunks) parts.push(await downloadItem(c));
  return Buffer.concat(parts);
}

async function deleteItemById(driveId: string, itemId: string): Promise<void> {
  await g(`/drives/${driveId}/items/${itemId}`, { method: "DELETE" });
}

/* ------------------------------ status ------------------------------- */

let statusCache: { at: number; value: StorageStatus } | null = null;
const STATUS_TTL_MS = 60 * 1000;

async function probeStatus(): Promise<StorageStatus> {
  if (!(await msConnected())) {
    return {
      provider: "sharepoint",
      configured: false,
      setupRequired: true,
      missingScopes: [...SHAREPOINT_MISSING_SCOPES],
      detail:
        "Microsoft account is not connected — reconnect in Settings → " +
        "Integrations so the token carries the Files/Sites scopes.",
    };
  }
  let drive: ResolvedDrive | null;
  try {
    drive = await ensureSharePointDrive(false);
  } catch (err) {
    if (err instanceof StorageSetupRequiredError) {
      return {
        provider: "sharepoint",
        configured: false,
        setupRequired: true,
        missingScopes: err.missingScopes,
        detail: err.message,
      };
    }
    return {
      provider: "sharepoint",
      configured: false,
      setupRequired: false,
      detail: `SharePoint probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!drive) {
    const site = await resolveSharePointSite().catch(() => null);
    return {
      provider: "sharepoint",
      configured: false,
      setupRequired: true,
      detail:
        `Site "${site?.displayName ?? DEFAULT_SITE_NAME}" found, but the ` +
        `"${DEFAULT_LIBRARY_NAME}" library is not provisioned yet — run ` +
        `"Provision SharePoint library" in Settings → Integrations.`,
    };
  }
  const active =
    (process.env.STORAGE_PROVIDER ?? "").trim().toLowerCase() === "sharepoint";
  return {
    provider: "sharepoint",
    configured: true,
    setupRequired: false,
    detail: active
      ? `Active — site "${drive.site.displayName}", library "${drive.driveName}". Bytes live in SharePoint behind the storage interface.`
      : `Ready — site "${drive.site.displayName}", library "${drive.driveName}" provisioned. Set STORAGE_PROVIDER=sharepoint to make it the active provider.`,
  };
}

/* ------------------------------ provider ------------------------------ */

export const sharepointProvider: StorageProvider = {
  name: "sharepoint",

  async status(): Promise<StorageStatus> {
    if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) {
      return statusCache.value;
    }
    const value = await probeStatus();
    statusCache = { at: Date.now(), value };
    return value;
  },

  async put(key, data) {
    const k = assertSafeKey(key);
    const { driveId } = await requireDrive();
    await putBytes(driveId, k, data);
  },

  async get(key) {
    const k = assertSafeKey(key);
    const { driveId } = await requireDrive();
    const item = await itemByPath(driveId, k);
    if (!item) throw new StorageNotFoundError(k);
    if (item.folder) return assembleChunks(driveId, k);
    return downloadItem(item);
  },

  async delete(key) {
    const k = assertSafeKey(key);
    const { driveId } = await requireDrive();
    const item = await itemByPath(driveId, k);
    if (item) await deleteItemById(driveId, item.id);
  },

  async exists(key) {
    const k = assertSafeKey(key);
    const { driveId } = await requireDrive();
    return (await itemByPath(driveId, k)) !== null;
  },

  async beginUpload(tempKey) {
    const k = assertSafeKey(tempKey);
    const { driveId } = await requireDrive();
    const existing = await itemByPath(driveId, k);
    if (existing) await deleteItemById(driveId, existing.id);
    await ensureFolder(driveId, k);
  },

  async appendChunk(tempKey, offset, data) {
    const k = assertSafeKey(tempKey);
    const { driveId } = await requireDrive();
    const folder = await itemByPath(driveId, k);
    if (!folder?.folder) {
      if (offset !== 0) throw new StorageOffsetError(0);
      await ensureFolder(driveId, k);
    }
    const chunks = await chunkChildren(driveId, k);
    const current = chunks.reduce((sum, c) => sum + (c.size ?? 0), 0);
    if (current !== offset) throw new StorageOffsetError(current);
    await putBytes(driveId, `${k}/${chunkName(offset)}`, data);
    return current + data.length;
  },

  async uploadSize(tempKey) {
    const k = assertSafeKey(tempKey);
    const { driveId } = await requireDrive();
    const item = await itemByPath(driveId, k);
    if (!item) return 0;
    if (!item.folder) return item.size ?? 0;
    const chunks = await chunkChildren(driveId, k);
    return chunks.reduce((sum, c) => sum + (c.size ?? 0), 0);
  },

  async finalizeUpload(tempKey, finalKey) {
    const from = assertSafeKey(tempKey);
    const to = assertSafeKey(finalKey);
    const { driveId } = await requireDrive();
    const item = await itemByPath(driveId, from);
    if (!item) throw new StorageNotFoundError(from);
    if (item.folder) {
      const bytes = await assembleChunks(driveId, from);
      await putBytes(driveId, to, bytes);
      await deleteItemById(driveId, item.id);
      return;
    }
    // Plain-file temp (docgen / portfolio): move + rename in place.
    const destDir = parentPath(to);
    const destFolder = await ensureFolder(driveId, destDir);
    await g(`/drives/${driveId}/items/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: baseName(to),
        parentReference: { id: destFolder.id },
      }),
    });
  },

  async abortUpload(tempKey) {
    const k = assertSafeKey(tempKey);
    const { driveId } = await requireDrive();
    const item = await itemByPath(driveId, k);
    if (item) await deleteItemById(driveId, item.id);
  },
};
