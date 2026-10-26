/**
 * Client dataset cache (Performance Fix Pass, DESIGN §7).
 *
 * Version-gated loading for the portal's read datasets: before paying
 * for a payload, ask /api/platform/versions (one tiny no-store GET,
 * coalesced across concurrent callers and memoized for 3s) what the
 * server's current version of the dataset is. When the cached copy was
 * stored under that same version, it is returned with changed:false
 * and NO payload request is made — the caller skips its setState, so
 * an unchanged section does not re-render.
 *
 * When the version moved (or there is no cached copy, or force is
 * set), the payload is fetched with the server version appended to the
 * URL (?v= / &_v=), so the versioned URL composes with the routes'
 * Cache-Control: private, max-age=300 — same version → same URL →
 * browser may serve; new version → new URL → fresh. The version stored
 * for the copy is the response's X-Dataset-Version header when present
 * (authoritative), else the versions-map value.
 *
 * Never throws: on a fetch error or non-OK response the cached copy
 * (or null) comes back with changed:false and the real status, so
 * callers keep their res.ok-style semantics — 401 in particular stays
 * visible for the Overview → /login redirect.
 */

export interface DatasetResult<T> {
  data: T | null;
  changed: boolean;
  status: number;
}

interface CacheEntry {
  version: number;
  data: unknown;
}

/** Cached payloads, keyed `${dataset}|${url}`. */
const entries = new Map<string, CacheEntry>();
/** Last server version seen per dataset (kept for invalidation). */
const knownVersions = new Map<string, number>();

/* ---------------- versions map (coalesced, 3s memo) ---------------- */

let versionsMemo: Record<string, number> = {};
let versionsMemoAt = 0;
let versionsInFlight: Promise<Record<string, number>> | null = null;

async function fetchVersions(force = false): Promise<Record<string, number>> {
  if (versionsInFlight) return versionsInFlight;
  if (!force && Date.now() - versionsMemoAt < 3000) return versionsMemo;
  versionsInFlight = (async () => {
    try {
      const r = await fetch("/api/platform/versions", { cache: "no-store" });
      if (r.ok) {
        const body: unknown = await r.json().catch(() => null);
        const versions =
          body && typeof body === "object"
            ? (body as { versions?: unknown }).versions
            : null;
        if (versions && typeof versions === "object") {
          versionsMemo = versions as Record<string, number>;
          versionsMemoAt = Date.now();
          for (const [k, v] of Object.entries(versionsMemo)) {
            if (typeof v === "number") knownVersions.set(k, v);
          }
        }
      }
    } catch {
      /* keep the last known map — loadDataset degrades to a plain fetch */
    }
    return versionsMemo;
  })();
  try {
    return await versionsInFlight;
  } finally {
    versionsInFlight = null;
  }
}

function withVersion(url: string, version: number): string {
  return url.includes("?")
    ? `${url}&_v=${version}`
    : `${url}?v=${version}`;
}

/* ------------------------------ loading ------------------------------ */

export async function loadDataset<T>(
  dataset: string,
  url: string,
  opts?: { force?: boolean }
): Promise<DatasetResult<T>> {
  const key = `${dataset}|${url}`;
  const entry = entries.get(key);
  try {
    const versions = await fetchVersions(opts?.force === true);
    const serverVersion =
      typeof versions[dataset] === "number" ? versions[dataset] : undefined;

    if (
      !opts?.force &&
      entry &&
      serverVersion !== undefined &&
      entry.version === serverVersion
    ) {
      return { data: entry.data as T, changed: false, status: 200 };
    }

    let res: Response;
    try {
      res = await fetch(
        serverVersion !== undefined ? withVersion(url, serverVersion) : url
      );
    } catch {
      return { data: (entry?.data as T) ?? null, changed: false, status: 0 };
    }
    if (!res.ok) {
      return {
        data: (entry?.data as T) ?? null,
        changed: false,
        status: res.status,
      };
    }
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      return {
        data: (entry?.data as T) ?? null,
        changed: false,
        status: res.status,
      };
    }
    if (data === null || data === undefined) {
      return {
        data: (entry?.data as T) ?? null,
        changed: false,
        status: res.status,
      };
    }

    const headerRaw = res.headers.get("X-Dataset-Version");
    const headerVersion = headerRaw !== null ? Number(headerRaw) : NaN;
    const version = Number.isFinite(headerVersion)
      ? headerVersion
      : serverVersion ?? entry?.version ?? 0;
    entries.set(key, { version, data });
    knownVersions.set(dataset, version);
    return { data, changed: true, status: res.status };
  } catch {
    return { data: (entry?.data as T) ?? null, changed: false, status: 0 };
  }
}

/* ---------------------------- invalidation ---------------------------- */

function dropEntries(dataset: string): void {
  const prefix = `${dataset}|`;
  for (const key of Array.from(entries.keys())) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

/** Drop every cached payload for a dataset (next load refetches). */
export function invalidateDataset(dataset: string): void {
  dropEntries(dataset);
}

/**
 * Local write-through invalidation: the caller just changed this
 * dataset itself, so drop its cached payloads AND forget the version
 * believed current (plus the shared versions memo) — the next
 * loadDataset re-checks versions and refetches unconditionally.
 */
export function bumpLocalDataset(dataset: string): void {
  dropEntries(dataset);
  knownVersions.delete(dataset);
  versionsMemoAt = 0;
}
