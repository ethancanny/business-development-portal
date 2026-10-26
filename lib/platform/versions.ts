import { sql, str, num } from "./db";

/**
 * Dataset version stamps (Performance Fix Pass, DESIGN.md §1).
 *
 * Every dataset clients cache carries a monotonic version in
 * core.dataset_versions. Write choke points bump the datasets they
 * touch AFTER their write commits; readers fetch the versions map
 * (GET /api/platform/versions) and skip payload fetches for datasets
 * whose version has not moved. Versioned GET routes also report
 * their dataset's version in the X-Dataset-Version response header,
 * read after the payload is computed — the client stores that exact
 * value.
 *
 * This module imports ONLY ./db (the codebase's cycle-avoidance rule):
 * anything that writes data may import it without a cycle.
 */

export const DATASETS = [
  "overview",
  "bd_bootstrap",
  "deals",
  "executives",
  "tasks",
  "interactions",
  "dealflow",
  "calendar",
  "investors",
  "market_multiples",
  "market_rates",
  "market_indicators",
  "market_tailwind",
  "market_companies",
  "hospitality_settings",
  "candidates",
  "directory",
  "capital",
  "badge",
] as const;

export type DatasetName = (typeof DATASETS)[number];

/**
 * Datasets also written by processes outside the app (external python
 * drains / spine builders), so a stored counter alone would miss
 * changes. Their effective version folds in a derived stamp from the
 * backing table: count(*) and max(updated_at).
 *
 * - candidates: operator_candidates — has updated_at (candidates-db).
 * - market_companies: mi_companies — checked in lib/market-db.ts /
 *   lib/db-postgres.ts: the companies table DOES carry
 *   `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` and the import
 *   upsert sets updated_at = NOW(), so the same derived treatment
 *   applies (not count-only).
 */
const DERIVED_TABLES: Partial<Record<DatasetName, string>> = {
  candidates: "operator_candidates",
  market_companies: "mi_companies",
};

/**
 * Derived-stamp cache (CPU close-out, Oct 26, 2026): the derived
 * aggregate over mi_companies scans ~62K rows and sits on the hottest
 * read path in the app — every GET /api/platform/versions and every
 * market-companies / candidates response header. The external writers
 * it exists to catch are batch jobs (weekly spine builders, twice-
 * daily drains), and every in-app writer ALSO bumps the stored
 * counter instantly, so a short per-instance TTL loses nothing that
 * matters: external changes surface within one TTL instead of
 * instantly. Failed reads are NOT cached (a transient error must not
 * mask a change for the TTL window).
 */
const DERIVED_TTL_MS = 10_000;
const derivedCache = new Map<DatasetName, { stamp: number; at: number }>();

/**
 * Derived stamp for one dataset: count * 2^33 + epochSec(max(updated_at)).
 * JS numbers are safe to 2^53: count ≤ ~1e5 → count * 2^33 ≈ 8.6e14,
 * epochSec ≈ 1.8e9 — the sum with the stored version stays exact.
 * Returns 0 when the backing table cannot be read (a missing derived
 * stamp must never sink a version read).
 */
async function derivedStamp(name: DatasetName): Promise<number> {
  const table = DERIVED_TABLES[name];
  if (!table) return 0;
  const hit = derivedCache.get(name);
  if (hit && Date.now() - hit.at < DERIVED_TTL_MS) return hit.stamp;
  try {
    const db = sql();
    const rows = await db.query(
      `SELECT count(*)::int AS n, max(updated_at) AS max_updated FROM ${table}`
    );
    if (!rows.length) return 0;
    const rec = rows[0] as Record<string, unknown>;
    const count = num(rec.n);
    const raw = rec.max_updated;
    let epochSec = 0;
    if (raw !== null && raw !== undefined && raw !== "") {
      const ms =
        raw instanceof Date ? raw.getTime() : new Date(String(raw)).getTime();
      if (isFinite(ms)) epochSec = Math.floor(ms / 1000);
    }
    const stamp = count * 2 ** 33 + epochSec;
    derivedCache.set(name, { stamp, at: Date.now() });
    return stamp;
  } catch {
    return 0;
  }
}

/**
 * Increment version stamps. NEVER throws (a failed bump must not
 * break a write) — failures are logged and swallowed.
 * One multi-row INSERT ... ON CONFLICT DO UPDATE per call.
 */
export async function bumpDatasets(...names: DatasetName[]): Promise<void> {
  const unique = Array.from(new Set(names));
  if (!unique.length) return;
  try {
    const db = sql();
    const values = unique.map((_, i) => `($${i + 1}, 1)`).join(", ");
    await db.query(
      `INSERT INTO core.dataset_versions (dataset, version)
       VALUES ${values}
       ON CONFLICT (dataset) DO UPDATE
         SET version = dataset_versions.version + 1, updated_at = now()`,
      [...unique]
    );
  } catch (err) {
    console.error("[platform/versions] bumpDatasets failed", err);
  }
}

/** One SELECT over core.dataset_versions (+ derived stamps, see above). */
export async function getDatasetVersions(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of DATASETS) out[name] = 1;
  const db = sql();
  const rows = await db`
    SELECT dataset, version FROM core.dataset_versions`;
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    const name = str(rec.dataset);
    if (name in out) out[name] = num(rec.version);
  }
  for (const name of Object.keys(DERIVED_TABLES) as DatasetName[]) {
    out[name] += await derivedStamp(name);
  }
  return out;
}

/** Read one dataset's current version (for X-Dataset-Version headers). */
export async function getDatasetVersion(name: DatasetName): Promise<number> {
  const db = sql();
  const rows = await db`
    SELECT version FROM core.dataset_versions WHERE dataset = ${name} LIMIT 1`;
  const stored = rows.length
    ? num((rows[0] as Record<string, unknown>).version)
    : 1;
  return stored + (await derivedStamp(name));
}

/**
 * {"X-Dataset-Version": "<n>"} for a versioned GET route, or {} when
 * the version cannot be read. NEVER throws — a route must never fail
 * over its version header.
 */
export async function datasetVersionHeader(
  name: DatasetName
): Promise<Record<string, string>> {
  try {
    const version = await getDatasetVersion(name);
    return { "X-Dataset-Version": String(version) };
  } catch {
    return {};
  }
}
